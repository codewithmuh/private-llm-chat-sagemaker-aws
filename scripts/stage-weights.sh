#!/usr/bin/env bash
# Copy a model's weights from Hugging Face into S3, once, so SageMaker loads
# them from S3 instead of downloading from the hub at every cold start.
#
#   ./scripts/stage-weights.sh <hf-model-id> <s3-uri>
#   ./scripts/stage-weights.sh Qwen/Qwen3-VL-8B-Instruct-FP8 s3://my-llm-weights/qwen3-vl-8b/
#
# Then set, for that model in terraform.tfvars:
#   weights_s3_uri = "s3://my-llm-weights/qwen3-vl-8b/"
# and run terraform apply.
#
# Why bother?
#   - Faster, steadier cold starts: S3 in the same region is quick, and does
#     not depend on huggingface.co being up or rate-limiting you.
#   - Required for sagemaker_vpc_isolated = true, where the model container has
#     no internet access at all.
#   - Pins the exact files you tested; a hub repo can change under you.
#
# Needs: the AWS CLI, the Hugging Face CLI (pip install -U "huggingface_hub[cli]"),
# and free disk space for the model (an 8B FP8 model is ~10 GB).
# Gated models: export HF_TOKEN=hf_... first.
# Put the bucket in the SAME REGION as the stack (an isolated endpoint can only
# reach S3 in its own region through the VPC's gateway endpoint).
set -euo pipefail

MODEL="${1:-}"
S3_URI="${2:-}"
[ -n "$MODEL" ] && [ -n "$S3_URI" ] || {
  sed -n '2,8p' "$0"
  exit 2
}
case "$S3_URI" in
  s3://*/*) ;;
  *)
    echo "The S3 URI must look like s3://bucket/prefix/" >&2
    exit 2
    ;;
esac
# SageMaker copies an "S3Prefix" as a folder: the URI must end with "/".
case "$S3_URI" in */) ;; *) S3_URI="$S3_URI/" ;; esac

BUCKET="$(printf '%s' "$S3_URI" | sed -E 's#^s3://([^/]+)/.*#\1#')"
REGION="${AWS_REGION:-$(aws configure get region 2>/dev/null || true)}"
[ -n "$REGION" ] || {
  echo "Set AWS_REGION to the region of your stack." >&2
  exit 1
}

# Skip formats vLLM does not load: PyTorch .pth/"original/" checkpoints that
# some repos ship next to the safetensors, and Flax/TensorFlow weights.
# The Hugging Face CLI is called `hf` in recent versions (one --exclude per
# pattern) and `huggingface-cli` in older ones (patterns after one --exclude).
if command -v hf >/dev/null 2>&1; then
  HF=(hf download)
  EXCLUDES=(--exclude "*.pth" --exclude "original/*" --exclude "*.msgpack" --exclude "*.h5")
elif command -v huggingface-cli >/dev/null 2>&1; then
  HF=(huggingface-cli download)
  EXCLUDES=(--exclude "*.pth" "original/*" "*.msgpack" "*.h5")
else
  echo "Install the Hugging Face CLI first:  pip install -U \"huggingface_hub[cli]\"" >&2
  exit 1
fi

# ------------------------------------------------------------ the bucket ---

if ! aws s3api head-bucket --bucket "$BUCKET" 2>/dev/null; then
  read -r -p "Bucket $BUCKET does not exist. Create it in $REGION? [y/N] " answer
  [ "$answer" = "y" ] || [ "$answer" = "Y" ] || exit 1
  if [ "$REGION" = "us-east-1" ]; then
    aws s3api create-bucket --bucket "$BUCKET" --region "$REGION" >/dev/null
  else
    aws s3api create-bucket --bucket "$BUCKET" --region "$REGION" \
      --create-bucket-configuration "LocationConstraint=$REGION" >/dev/null
  fi
  aws s3api put-public-access-block --bucket "$BUCKET" --region "$REGION" \
    --public-access-block-configuration \
    BlockPublicAcls=true,IgnorePublicAcls=true,BlockPublicPolicy=true,RestrictPublicBuckets=true
else
  BUCKET_REGION="$(aws s3api get-bucket-location --bucket "$BUCKET" --query LocationConstraint --output text)"
  [ "$BUCKET_REGION" = "None" ] && BUCKET_REGION="us-east-1"
  if [ "$BUCKET_REGION" != "$REGION" ]; then
    echo "Warning: $BUCKET is in $BUCKET_REGION, the stack in $REGION. Downloads will be slower and cross-region;"
    echo "         an isolated (VPC) endpoint cannot reach it at all."
  fi
fi

# -------------------------------------------------------------- download ---

WORK="${TMPDIR:-/tmp}/llmchat-weights/$(printf '%s' "$MODEL" | tr '/' '_')"
mkdir -p "$WORK"
echo "Downloading $MODEL to $WORK (resumes if interrupted) ..."
"${HF[@]}" "$MODEL" --local-dir "$WORK" "${EXCLUDES[@]}"

# ---------------------------------------------------------------- upload ---

echo "Uploading to $S3_URI ..."
# .cache/ is the CLI's own bookkeeping inside the download folder.
aws s3 sync "$WORK/" "$S3_URI" --region "$REGION" --exclude ".cache/*" --only-show-errors

aws s3 ls "$S3_URI" --recursive --summarize --region "$REGION" | tail -2

cat <<MSG

Staged $MODEL at $S3_URI

In infra/terraform/terraform.tfvars, for this model:
  weights_s3_uri = "$S3_URI"
Keep hf_model_id = "$MODEL": it is still the name the app sends as "model".

Free the local copy with:  rm -rf "$WORK"
MSG
