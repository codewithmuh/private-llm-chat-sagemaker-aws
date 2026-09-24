#!/usr/bin/env python3
"""Deploy an open-source LLM to your own SageMaker endpoint: three API calls.

    python ml/sagemaker/deploy.py presets
    python ml/sagemaker/deploy.py deploy qwen3-vl-8b          # ~10-15 min
    python ml/sagemaker/deploy.py chat   llmchat-qwen3-vl-8b "Hello!"
    python ml/sagemaker/deploy.py stop   llmchat-qwen3-vl-8b  # stops billing
    python ml/sagemaker/deploy.py start  llmchat-qwen3-vl-8b  # back in ~10 min
    python ml/sagemaker/deploy.py delete llmchat-qwen3-vl-8b  # removes everything

This script is the "learn how it works" path. It does by hand what the
Terraform in infra/ does for the full application. Read it top to bottom:
every SageMaker deployment is these same three objects.

    1. Model                  WHAT to run: a container image + settings
                              (here: AWS's vLLM container + a Hugging Face model id)
    2. EndpointConfiguration  ON WHAT: instance type (which GPU) and how many
    3. Endpoint               the running thing you pay for, by the hour

Credentials come from your normal AWS setup (AWS_PROFILE / `aws configure` /
SSO). Only boto3 is required: `pip install boto3`.
"""

from __future__ import annotations

import argparse
import json
import sys
import time
from pathlib import Path

import boto3
from botocore.exceptions import ClientError

CATALOG = Path(__file__).resolve().parent.parent / "models" / "catalog.json"

# AWS's own vLLM "Deep Learning Container" built for SageMaker. SageMaker pulls
# it straight from AWS's registry in your region, so there is nothing to build.
# 763104351884 is the DLC account in most commercial regions; a few opt-in
# regions (e.g. af-south-1, ap-east-1, me-south-1) use a different one. See
# https://aws.github.io/deep-learning-containers/reference/available_images/
DLC_ACCOUNT = "763104351884"
DLC_TAG = "0.30-gpu-py312-cu130-ubuntu24.04-sagemaker"
ROLE_NAME = "llmchat-sagemaker-execution"


def load_presets() -> dict:
    return json.loads(CATALOG.read_text())["presets"]


def dlc_image(region: str) -> str:
    return f"{DLC_ACCOUNT}.dkr.ecr.{region}.amazonaws.com/vllm:{DLC_TAG}"


def say(message: str) -> None:
    print(message, flush=True)


# ------------------------------------------------------------------- IAM ----


def ensure_role(iam) -> str:
    """The identity the endpoint runs as. It needs to pull the container image
    and write logs; nothing else. (Your model weights come from Hugging Face
    over the internet in this beginner setup.)"""
    try:
        return iam.get_role(RoleName=ROLE_NAME)["Role"]["Arn"]
    except iam.exceptions.NoSuchEntityException:
        pass
    say(f"Creating IAM role {ROLE_NAME} ...")
    arn = iam.create_role(
        RoleName=ROLE_NAME,
        Description="Lets SageMaker endpoints pull images and write logs (private-llm-chat-sagemaker-aws)",
        AssumeRolePolicyDocument=json.dumps(
            {
                "Version": "2012-10-17",
                "Statement": [
                    {"Effect": "Allow", "Principal": {"Service": "sagemaker.amazonaws.com"}, "Action": "sts:AssumeRole"}
                ],
            }
        ),
    )["Role"]["Arn"]
    iam.put_role_policy(
        RoleName=ROLE_NAME,
        PolicyName="pull-images-write-logs",
        PolicyDocument=json.dumps(
            {
                "Version": "2012-10-17",
                "Statement": [
                    {
                        "Effect": "Allow",
                        "Action": [
                            "ecr:GetAuthorizationToken",
                            "ecr:BatchCheckLayerAvailability",
                            "ecr:GetDownloadUrlForLayer",
                            "ecr:BatchGetImage",
                        ],
                        "Resource": "*",
                    },
                    {
                        "Effect": "Allow",
                        "Action": ["logs:CreateLogGroup", "logs:CreateLogStream", "logs:PutLogEvents"],
                        "Resource": "arn:aws:logs:*:*:log-group:/aws/sagemaker/*",
                    },
                    {"Effect": "Allow", "Action": "cloudwatch:PutMetricData", "Resource": "*"},
                ],
            }
        ),
    )
    # IAM is eventually consistent: a brand-new role can take a few seconds
    # before SageMaker is allowed to assume it.
    time.sleep(10)
    return arn


# ---------------------------------------------------------------- deploy ----


def deploy(args) -> None:
    presets = load_presets()
    if args.preset not in presets:
        sys.exit(f"Unknown preset {args.preset!r}. Run: python {sys.argv[0]} presets")
    p = presets[args.preset]
    if p.get("gated") and not args.hf_token:
        sys.exit(f"{p['hf_model_id']} is gated: accept its licence on huggingface.co, then pass --hf-token hf_...")

    session = boto3.Session(region_name=args.region)
    region = session.region_name
    sm = session.client("sagemaker")
    endpoint = args.name or f"llmchat-{args.preset}"
    instance = args.instance_type or p["instance_type"]
    stamp = time.strftime("%Y%m%d-%H%M%S")
    role_arn = args.role_arn or ensure_role(session.client("iam"))

    # vLLM is configured with SM_VLLM_* variables; each becomes a
    # `vllm serve --...` flag (SM_VLLM_MAX_MODEL_LEN -> --max-model-len).
    environment = {
        "SM_VLLM_MODEL": p["hf_model_id"],
        # The name clients send as "model". Keeping it equal to the Hugging
        # Face id means the app's `model_id` is simply that id.
        "SM_VLLM_SERVED_MODEL_NAME": p["hf_model_id"],
        "SM_VLLM_MAX_MODEL_LEN": str(args.max_model_len or p["max_model_len"]),
        "SM_VLLM_GPU_MEMORY_UTILIZATION": "0.90",
        "SM_VLLM_TENSOR_PARALLEL_SIZE": str(p.get("tensor_parallel_size", 1)),
        **p.get("extra_env", {}),
    }
    if p.get("vision"):
        environment["SM_VLLM_LIMIT_MM_PER_PROMPT"] = json.dumps({"image": 4})
    if args.hf_token:
        # Note: environment variables are visible in the SageMaker console to
        # anyone with sagemaker:DescribeModel. Use a read-only token.
        environment["HF_TOKEN"] = args.hf_token

    model_name = f"{endpoint}-{stamp}"[:63]
    say(f"1/3  Model                  {model_name}\n     image {args.image or dlc_image(region)}\n     weights {p['hf_model_id']} (downloaded from Hugging Face at startup)")
    for attempt in range(6):
        try:
            sm.create_model(
                ModelName=model_name,
                ExecutionRoleArn=role_arn,
                PrimaryContainer={"Image": args.image or dlc_image(region), "Environment": environment},
            )
            break
        except ClientError as exc:
            if "assume" in str(exc).lower() and attempt < 5:  # role still propagating
                time.sleep(10)
                continue
            raise

    config_name = f"{endpoint}-{stamp}"[:63]
    say(f"2/3  Endpoint configuration {config_name}\n     {instance} ({p['gpu']}), ~${p['hourly_usd']}/hour while running")
    sm.create_endpoint_config(
        EndpointConfigName=config_name,
        ProductionVariants=[
            {
                "VariantName": "primary",
                "ModelName": model_name,
                "InstanceType": instance,
                "InitialInstanceCount": 1,
                # Downloading ~10-20 GB of weights and loading them onto the
                # GPU takes minutes. The defaults are too short for LLMs.
                "ContainerStartupHealthCheckTimeoutInSeconds": 1800,
                "ModelDataDownloadTimeoutInSeconds": 1800,
            }
        ],
        # DataCaptureConfig is deliberately NOT set. It would save every
        # prompt and every answer to S3: the opposite of a private chat.
    )

    say(f"3/3  Endpoint               {endpoint}")
    try:
        sm.create_endpoint(EndpointName=endpoint, EndpointConfigName=config_name)
    except ClientError as exc:
        if "already existing" in str(exc) or "already exists" in str(exc):
            say("     exists already: switching it to the new configuration (blue/green update)")
            sm.update_endpoint(EndpointName=endpoint, EndpointConfigName=config_name)
        elif "ResourceLimitExceeded" in str(exc):
            sys.exit(
                f"\nNo GPU quota for {instance} in {region}.\n"
                "Request it: Service Quotas > Amazon SageMaker > "
                f'"{instance} for endpoint usage" (see docs/03-deploy-a-model-on-sagemaker.md).'
            )
        else:
            raise

    if not args.no_wait:
        wait_in_service(sm, endpoint)
    print_app_config(endpoint, config_name, p, region)


def wait_in_service(sm, endpoint: str) -> None:
    say("\nWaiting for the endpoint (weights download + model load: usually 8-15 minutes) ...")
    started = time.time()
    last = None
    while True:
        desc = sm.describe_endpoint(EndpointName=endpoint)
        status = desc["EndpointStatus"]
        if status != last:
            say(f"  [{int(time.time() - started) // 60:>2} min] {status}")
            last = status
        if status == "InService":
            say("Ready.")
            return
        if status == "Failed":
            sys.exit(
                f"\nThe endpoint failed: {desc.get('FailureReason', 'no reason given')}\n"
                f"Container logs: CloudWatch > Log groups > /aws/sagemaker/Endpoints/{endpoint}"
            )
        time.sleep(30)


def print_app_config(endpoint: str, config_name: str, p: dict, region: str) -> None:
    entry = {
        "id": endpoint.removeprefix("llmchat-"),
        "name": p["name"],
        "description": p["description"],
        "provider": "sagemaker",
        "model_id": p["hf_model_id"],
        "endpoint_name": endpoint,
        # Lets the app's GPU controller re-create the endpoint if you switch
        # "scaling" to "on_demand" (start when used, delete when idle).
        "endpoint_config_name": config_name,
        "region": region,
        "scaling": "manual",
        "vision": p["vision"],
        "ocr": p["ocr"],
        "context_window": p["max_model_len"],
        "max_output_tokens": 4096,
        "default": True,
    }
    say("\nTo use it from the app, put this in your .env (LLM_MODELS is a JSON list):\n")
    say(f"LLM_MODELS='{json.dumps([entry])}'")
    say(f"\nTry it now:   python {sys.argv[0]} chat {endpoint} \"Hello!\"")
    say(f"Stop billing: python {sys.argv[0]} stop {endpoint}")


# ------------------------------------------------------------------ chat ----


def chat(args) -> None:
    """Stream one answer: the same call the backend makes
    (apps/llm/providers/sagemaker.py)."""
    runtime = boto3.Session(region_name=args.region).client("sagemaker-runtime")
    content: list = [{"type": "text", "text": args.prompt}]
    if args.image:
        import base64
        import mimetypes

        mime = mimetypes.guess_type(args.image)[0] or "image/jpeg"
        data = base64.b64encode(Path(args.image).read_bytes()).decode()
        content.insert(0, {"type": "image_url", "image_url": {"url": f"data:{mime};base64,{data}"}})
    body = {"messages": [{"role": "user", "content": content}], "max_tokens": args.max_tokens, "stream": True}
    response = runtime.invoke_endpoint_with_response_stream(
        EndpointName=args.endpoint, ContentType="application/json", Body=json.dumps(body)
    )
    buffer = b""
    for event in response["Body"]:
        buffer += event.get("PayloadPart", {}).get("Bytes", b"")
        while b"\n" in buffer:
            line, buffer = buffer.split(b"\n", 1)
            line = line.strip()
            if line.startswith(b"data:"):
                line = line[5:].strip()
            if not line or line == b"[DONE]":
                continue
            chunk = json.loads(line)
            for choice in chunk.get("choices", []):
                delta = choice.get("delta", {})
                text = delta.get("reasoning_content") or delta.get("content") or ""
                print(text, end="", flush=True)
    print()


# ------------------------------------------------------- start/stop/delete ----


def latest_config(sm, endpoint: str) -> str | None:
    configs = sm.list_endpoint_configs(NameContains=endpoint, SortBy="CreationTime", SortOrder="Descending")
    names = [c["EndpointConfigName"] for c in configs["EndpointConfigs"] if c["EndpointConfigName"].startswith(endpoint)]
    return names[0] if names else None


def status(args) -> None:
    sm = boto3.Session(region_name=args.region).client("sagemaker")
    try:
        desc = sm.describe_endpoint(EndpointName=args.endpoint)
    except ClientError:
        say(f"{args.endpoint}: not running (no endpoint). Billing: $0.")
        cfg = latest_config(sm, args.endpoint)
        if cfg:
            say(f"Latest configuration: {cfg}. Start it with: python {sys.argv[0]} start {args.endpoint}")
        return
    say(f"{args.endpoint}: {desc['EndpointStatus']}  (config {desc['EndpointConfigName']})")
    if desc.get("FailureReason"):
        say(f"Failure: {desc['FailureReason']}")


def stop(args) -> None:
    """Delete the endpoint only. Billing stops; model + configuration stay,
    so `start` brings it back without re-entering anything."""
    sm = boto3.Session(region_name=args.region).client("sagemaker")
    sm.delete_endpoint(EndpointName=args.endpoint)
    say(f"Deleting {args.endpoint}. GPU billing stops within a minute or two.")


def start(args) -> None:
    sm = boto3.Session(region_name=args.region).client("sagemaker")
    cfg = latest_config(sm, args.endpoint)
    if not cfg:
        sys.exit(f"No configuration found for {args.endpoint}. Deploy it first.")
    sm.create_endpoint(EndpointName=args.endpoint, EndpointConfigName=cfg)
    say(f"Starting {args.endpoint} from {cfg}.")
    if not args.no_wait:
        wait_in_service(sm, args.endpoint)


def delete(args) -> None:
    sm = boto3.Session(region_name=args.region).client("sagemaker")
    try:
        sm.delete_endpoint(EndpointName=args.endpoint)
        say(f"Deleted endpoint {args.endpoint}")
    except ClientError:
        say(f"No running endpoint {args.endpoint}")
    configs = sm.list_endpoint_configs(NameContains=args.endpoint)["EndpointConfigs"]
    for c in configs:
        name = c["EndpointConfigName"]
        if not name.startswith(args.endpoint):
            continue
        models = {v["ModelName"] for v in sm.describe_endpoint_config(EndpointConfigName=name)["ProductionVariants"]}
        sm.delete_endpoint_config(EndpointConfigName=name)
        say(f"Deleted endpoint configuration {name}")
        for m in models:
            try:
                sm.delete_model(ModelName=m)
                say(f"Deleted model {m}")
            except ClientError:
                pass
    say(f"The IAM role {ROLE_NAME} is kept (it costs nothing); delete it in the IAM console if you like.")


def presets(_args) -> None:
    rows = load_presets()
    say(f"{'preset':<30} {'instance':<17} {'$/h':>6}  {'vision':<6} {'gated':<6} model")
    for key, p in rows.items():
        say(
            f"{key:<30} {p['instance_type']:<17} {p['hourly_usd']:>6.2f}  "
            f"{'yes' if p['vision'] else '':<6} {'yes' if p['gated'] else '':<6} {p['hf_model_id']}"
        )


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--region", default=None, help="AWS region (default: your AWS config)")
    sub = parser.add_subparsers(dest="command", required=True)

    sub.add_parser("presets", help="list ready-made models").set_defaults(fn=presets)

    p = sub.add_parser("deploy", help="create model + configuration + endpoint")
    p.add_argument("preset")
    p.add_argument("--name", help="endpoint name (default llmchat-<preset>)")
    p.add_argument("--instance-type")
    p.add_argument("--max-model-len", type=int)
    p.add_argument("--hf-token", help="Hugging Face token, for gated models")
    p.add_argument("--role-arn", help="use this execution role instead of creating one")
    p.add_argument("--image", help="override the container image")
    p.add_argument("--no-wait", action="store_true")
    p.set_defaults(fn=deploy)

    p = sub.add_parser("chat", help="send one message and stream the answer")
    p.add_argument("endpoint")
    p.add_argument("prompt")
    p.add_argument("--image", help="attach a local image (vision models)")
    p.add_argument("--max-tokens", type=int, default=1024)
    p.set_defaults(fn=chat)

    for name, fn, text in (
        ("status", status, "is it running?"),
        ("stop", stop, "delete the endpoint only (stops billing)"),
        ("start", start, "recreate the endpoint from its latest configuration"),
        ("delete", delete, "delete endpoint, configurations and models"),
    ):
        p = sub.add_parser(name, help=text)
        p.add_argument("endpoint")
        if name == "start":
            p.add_argument("--no-wait", action="store_true")
        p.set_defaults(fn=fn)

    args = parser.parse_args()
    args.fn(args)


if __name__ == "__main__":
    main()
