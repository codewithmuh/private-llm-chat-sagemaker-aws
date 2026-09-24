#!/usr/bin/env bash
# Build the api and web images, push them to ECR, and roll them out.
#
#   ./scripts/deploy.sh                 build, push, terraform apply (asks to confirm)
#   ./scripts/deploy.sh --yes           ... without the confirmation prompt
#   ./scripts/deploy.sh --skip-build    re-apply an existing tag (IMAGE_TAG, or the last deployed one)
#   IMAGE_TAG=v1 ./scripts/deploy.sh    use your own tag instead of the git commit
#
# Environment:
#   AWS_PROFILE   the AWS CLI profile to use (e.g. export AWS_PROFILE=my-profile)
#   AWS_REGION    optional; the region always comes from Terraform (aws_region)
#
# Why Terraform does the rollout (instead of `aws ecs update-service`): the task
# definitions (environment, secrets, sizes) are defined in Terraform. If this
# script registered its own revisions, the next `terraform apply` would undo
# them, or they would undo Terraform's changes. One source of truth: Terraform.
#
# First time? It works on an empty stack too: if the ECR repositories do not
# exist yet, it creates just them first (terraform apply -target=module.ecr),
# then builds, pushes and applies everything.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
TF_DIR="$ROOT/infra/terraform"

# A plain string, not an array: macOS still ships bash 3.2, where an empty
# array under `set -u` is an "unbound variable" error.
AUTO_APPROVE=""
SKIP_BUILD=false
for arg in "$@"; do
  case "$arg" in
    -y | --yes) AUTO_APPROVE="-auto-approve" ;;
    --skip-build) SKIP_BUILD=true ;;
    -h | --help)
      sed -n '2,20p' "$0"
      exit 0
      ;;
    *)
      echo "Unknown option: $arg (try --help)" >&2
      exit 2
      ;;
  esac
done

say() { printf '\n\033[1m==> %s\033[0m\n' "$*"; }
die() {
  printf '\033[31mError:\033[0m %s\n' "$*" >&2
  exit 1
}

# ------------------------------------------------------------- preflight ----

for cmd in aws docker terraform git; do
  command -v "$cmd" >/dev/null 2>&1 || die "'$cmd' is not installed. See docs/04-deploy-the-full-stack-on-aws.md, 'Prerequisites'."
done
docker buildx version >/dev/null 2>&1 || die "docker buildx is missing (it ships with Docker Desktop and recent Docker Engine)."
docker info >/dev/null 2>&1 || die "Docker is not running."

# Reads one key of a JSON object on stdin. jq if you have it, else python3.
json_get() {
  if command -v jq >/dev/null 2>&1; then
    jq -r --arg k "$1" '.[$k] // empty'
  else
    python3 -c 'import json,sys; v=json.load(sys.stdin).get(sys.argv[1]); print("" if v is None else v)' "$1"
  fi
}

tf() { terraform -chdir="$TF_DIR" "$@"; }
tf_output_raw() { tf output -raw "$1" 2>/dev/null || true; }

[ -f "$TF_DIR/terraform.tfvars" ] || [ -n "${TF_VAR_project:-}" ] \
  || echo "Note: no infra/terraform/terraform.tfvars; using the defaults (cp terraform.tfvars.example terraform.tfvars to customise)."

if [ ! -d "$TF_DIR/.terraform" ]; then
  say "terraform init"
  tf init -input=false
fi

aws sts get-caller-identity --query Arn --output text >/dev/null 2>&1 \
  || die "AWS credentials are not working. Run 'aws configure' / 'aws sso login' and export AWS_PROFILE."

# ------------------------------------------------ ecr repositories (first run)

REPOS_JSON="$(tf output -json ecr_repository_urls 2>/dev/null || true)"
[ -n "$REPOS_JSON" ] || REPOS_JSON='{}'
API_REPO="$(printf '%s' "$REPOS_JSON" | json_get api 2>/dev/null || true)"
if [ -z "$API_REPO" ]; then
  say "No ECR repositories in the Terraform state yet: creating them first"
  echo "(terraform warns that -target is for exceptional cases; this is one.)"
  tf apply -input=false ${AUTO_APPROVE:+"$AUTO_APPROVE"} -target=module.ecr
  REPOS_JSON="$(tf output -json ecr_repository_urls)"
  API_REPO="$(printf '%s' "$REPOS_JSON" | json_get api)"
fi
WEB_REPO="$(printf '%s' "$REPOS_JSON" | json_get web)"
[ -n "$API_REPO" ] && [ -n "$WEB_REPO" ] || die "Could not read the ECR repository URLs from 'terraform output ecr_repository_urls'."

# The region is whatever Terraform deployed to; AWS_REGION must agree.
REGION="$(tf_output_raw aws_region)"
if [ -z "$REGION" ]; then
  # Only ECR has been applied so far; the repository URL contains the region.
  REGION="$(printf '%s' "$API_REPO" | sed -E 's#^[0-9]+\.dkr\.ecr\.([a-z0-9-]+)\.amazonaws\.com.*#\1#')"
fi
if [ -n "${AWS_REGION:-}" ] && [ "$AWS_REGION" != "$REGION" ]; then
  echo "Warning: AWS_REGION=$AWS_REGION but the stack is in $REGION. Using $REGION."
fi
export AWS_REGION="$REGION"
REGISTRY="${API_REPO%%/*}"

# ---------------------------------------------------------------- the tag ---
# The git commit, so every running container maps to exactly one commit. With
# uncommitted changes the tag says so, and gets a timestamp so it is unique.

if [ -n "${IMAGE_TAG:-}" ]; then
  TAG="$IMAGE_TAG"
elif [ "$SKIP_BUILD" = true ] && [ -f "$TF_DIR/image.auto.tfvars" ]; then
  TAG="$(sed -nE 's/^image_tag *= *"([^"]+)".*/\1/p' "$TF_DIR/image.auto.tfvars")"
else
  TAG="$(git -C "$ROOT" rev-parse --short=12 HEAD)"
  if [ -n "$(git -C "$ROOT" status --porcelain -- backend frontend docs ml/models)" ]; then
    TAG="$TAG-dirty-$(date +%Y%m%d%H%M%S)"
  fi
fi
[ -n "$TAG" ] || die "No image tag. Set IMAGE_TAG=<tag>."

echo "Region   : $REGION"
echo "Registry : $REGISTRY"
echo "Tag      : $TAG"

# ------------------------------------------------------------ build + push --

image_exists() { # image_exists <repository url> <tag>
  aws ecr describe-images --region "$REGION" --repository-name "${1#*/}" \
    --image-ids imageTag="$2" >/dev/null 2>&1
}

if [ "$SKIP_BUILD" = false ]; then
  say "Logging in to ECR"
  aws ecr get-login-password --region "$REGION" \
    | docker login --username AWS --password-stdin "$REGISTRY"

  # linux/arm64 because the ECS tasks run on Graviton (ARM64). On an Intel/AMD
  # machine Docker emulates ARM with QEMU: it works, just slower (Docker
  # Desktop has it built in; on Linux run once:
  #   docker run --privileged --rm tonistiigi/binfmt --install arm64).
  # --provenance=false: push a plain image, not an image index with an extra
  # "unknown/unknown" attestation entry.

  if image_exists "$API_REPO" "$TAG"; then
    echo "api:$TAG is already in ECR, skipping the build."
  else
    say "Building and pushing api:$TAG (backend/, target api)"
    docker buildx build --platform linux/arm64 --provenance=false \
      --target api \
      --tag "$API_REPO:$TAG" \
      --push "$ROOT/backend"
  fi

  if image_exists "$WEB_REPO" "$TAG"; then
    echo "web:$TAG is already in ECR, skipping the build."
  else
    say "Building and pushing web:$TAG (frontend/, with docs/ and ml/models/)"
    # NEXT_PUBLIC_API_URL is baked in at BUILD time. Empty = "same origin":
    # the browser calls /api/... on the domain it loaded the page from, and
    # CloudFront routes that to Django.
    # The context is the repository root: the /docs pages are built from
    # docs/*.md and the landing page reads ml/models/catalog.json.
    docker buildx build --platform linux/arm64 --provenance=false \
      --file "$ROOT/frontend/Dockerfile" \
      --build-arg NEXT_PUBLIC_API_URL= \
      --tag "$WEB_REPO:$TAG" \
      --push "$ROOT"
  fi
else
  image_exists "$API_REPO" "$TAG" || die "api:$TAG is not in ECR. Build it first (run without --skip-build)."
  image_exists "$WEB_REPO" "$TAG" || die "web:$TAG is not in ECR. Build it first (run without --skip-build)."
fi

# --------------------------------------------------------------- rollout ----

# Remember the tag, so a later plain `terraform apply` (e.g. to change a model)
# keeps these images instead of scaling the services back to zero.
printf '# Written by scripts/deploy.sh. The image tag currently deployed.\nimage_tag = "%s"\n' "$TAG" >"$TF_DIR/image.auto.tfvars"

say "terraform apply -var image_tag=$TAG"
tf apply -input=false ${AUTO_APPROVE:+"$AUTO_APPROVE"} -var "image_tag=$TAG"

CLUSTER="$(tf_output_raw ecs_cluster_name)"
APP_URL="$(tf_output_raw app_url)"

say "Waiting for the ECS services to become stable (up to ~10 minutes)"
if aws ecs wait services-stable --region "$REGION" --cluster "$CLUSTER" \
  --services api web gpu-controller; then
  echo "All services are running the new images."
else
  cat <<MSG
The services did not settle in time. This is not always an error (the first
start runs every database migration), but check the logs:

  aws logs tail /ecs/$CLUSTER/api --since 15m --region $REGION
  aws ecs describe-services --cluster $CLUSTER --services api --region $REGION \\
    --query 'services[0].events[:5].message'

A deployment that keeps failing is rolled back automatically (circuit breaker).
MSG
  exit 1
fi

cat <<MSG

Deployed $TAG.

  App:          $APP_URL
  API logs:     aws logs tail /ecs/$CLUSTER/api --follow --region $REGION
  GPU status:   ./scripts/gpu.sh status

MSG
