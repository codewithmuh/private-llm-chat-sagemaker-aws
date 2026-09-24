#!/usr/bin/env bash
# See, start and stop the SageMaker GPU endpoints by hand.
#
#   ./scripts/gpu.sh status [model]     what is running, and what it costs per hour
#   ./scripts/gpu.sh start  <model>     create the endpoint (5-15 minutes to InService)
#   ./scripts/gpu.sh stop   [model]     delete the endpoint(s); billing stops within minutes
#
# <model> is the model slug from terraform.tfvars (e.g. qwen3-vl-8b). Without
# one, status and stop act on every model. The names come from
# `terraform output sagemaker_endpoints`; without Terraform state you can pass
# them yourself:
#   ENDPOINT_NAME=llmchat-dev-qwen3-vl-8b ./scripts/gpu.sh stop
#   ENDPOINT_NAME=... ENDPOINT_CONFIG_NAME=... ./scripts/gpu.sh start
#
# Deleting an endpoint loses nothing: the model and endpoint configuration stay
# (Terraform owns those), so starting again is a single API call.
#
# IMPORTANT: normally the app's GPU CONTROLLER owns the endpoints. Every ~30 s
# it re-applies each model's `scaling` setting, and will undo what you do here:
#   always_on  -> a stopped endpoint is started again
#   on_demand  -> a started endpoint is deleted after idle_minutes without chats;
#                 a stopped one starts again at the next chat message
#   off        -> a started endpoint is deleted again
#   manual     -> the controller never touches it: this script is in charge
# To keep a model off for good, set scaling = "off" (terraform.tfvars, or the
# model in /admin/). This script is for checking costs, emergencies, and teardown.
#
# Environment: AWS_PROFILE; region from Terraform (or AWS_REGION).
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
TF_DIR="$ROOT/infra/terraform"
ACTION="${1:-status}"
SLUG="${2:-}"

die() {
  printf 'Error: %s\n' "$*" >&2
  exit 1
}

command -v aws >/dev/null 2>&1 || die "the AWS CLI is not installed."

# --------------------------------------------------- which endpoints? -------
# One line per model: slug<TAB>endpoint<TAB>config<TAB>instance<TAB>$/hour<TAB>scaling

models_tsv() {
  if [ -n "${ENDPOINT_NAME:-}" ]; then
    printf '%s\t%s\t%s\t%s\t%s\t%s\n' "${SLUG:-manual}" "$ENDPOINT_NAME" "${ENDPOINT_CONFIG_NAME:-}" "?" "${HOURLY_COST_USD:-0}" "?"
    return
  fi
  local json
  json="$(terraform -chdir="$TF_DIR" output -json sagemaker_endpoints 2>/dev/null)" \
    || die "cannot read 'terraform output sagemaker_endpoints'. Run from a checkout with Terraform state, or set ENDPOINT_NAME."
  if command -v jq >/dev/null 2>&1; then
    printf '%s' "$json" | jq -r 'to_entries[] | [.key, .value.endpoint_name, .value.endpoint_config_name, .value.instance_type, (.value.hourly_cost_usd|tostring), .value.scaling] | @tsv'
  else
    printf '%s' "$json" | python3 -c '
import json, sys
for slug, e in json.load(sys.stdin).items():
    print("\t".join([slug, e["endpoint_name"], e["endpoint_config_name"], e["instance_type"], str(e["hourly_cost_usd"]), e["scaling"]]))'
  fi
}

REGION="${AWS_REGION:-$(aws configure get region 2>/dev/null || true)}"
if [ -z "${ENDPOINT_NAME:-}" ]; then
  REGION="$(terraform -chdir="$TF_DIR" output -raw aws_region 2>/dev/null || echo "$REGION")"
fi
[ -n "$REGION" ] || die "unknown region: set AWS_REGION."
PREFIX="$(terraform -chdir="$TF_DIR" output -raw name_prefix 2>/dev/null || true)"

sm() { aws sagemaker --region "$REGION" "$@"; }

# "NotRunning" only when SageMaker says the endpoint does not exist. Any other
# failure (expired credentials, wrong region...) stops the script, so it never
# reports "$0" for an endpoint it simply could not see.
endpoint_status() {
  local out
  if out="$(sm describe-endpoint --endpoint-name "$1" --query EndpointStatus --output text 2>&1)"; then
    echo "$out"
  elif printf '%s' "$out" | grep -q "Could not find endpoint"; then
    echo "NotRunning"
  else
    die "describe-endpoint $1 failed: $out"
  fi
}

MODELS="$(models_tsv)"
if [ -n "$SLUG" ] && [ -z "${ENDPOINT_NAME:-}" ]; then
  MODELS="$(printf '%s\n' "$MODELS" | awk -F'\t' -v s="$SLUG" '$1 == s')"
  [ -n "$MODELS" ] || die "no model '$SLUG'. Known: $(models_tsv | cut -f1 | tr '\n' ' ')"
fi

controller_note() { # controller_note <scaling> <start|stop>
  case "$1:$2" in
    always_on:stop) echo "   Note: scaling = always_on, so the GPU controller will start it again within a minute." ;;
    on_demand:stop) echo "   Note: scaling = on_demand, so the next chat message will start it again." ;;
    off:start) echo "   Note: scaling = off, so the GPU controller will delete it again within a minute." ;;
    on_demand:start) echo "   Note: scaling = on_demand, so the controller deletes it after idle_minutes without chats." ;;
  esac
}

case "$ACTION" in
  status)
    total="0"
    printf '%-24s %-36s %-14s %-16s %s\n' MODEL ENDPOINT STATUS INSTANCE COST
    while IFS=$'\t' read -r slug endpoint _config instance rate scaling; do
      [ -n "$slug" ] || continue
      status="$(endpoint_status "$endpoint")"
      case "$status" in
        NotRunning) cost="\$0 (not running)" ;;
        InService | Creating | Updating | SystemUpdating | RollingBack | Deleting)
          cost="$(awk -v r="$rate" 'BEGIN { printf "~$%.2f/hour (~$%.0f/day)", r, r * 24 }')"
          total="$(awk -v t="$total" -v r="$rate" 'BEGIN { print t + r }')"
          ;;
        *) cost="-" ;;
      esac
      printf '%-24s %-36s %-14s %-16s %s  [scaling: %s]\n' "$slug" "$endpoint" "$status" "$instance" "$cost" "$scaling"
    done <<<"$MODELS"
    echo
    awk -v t="$total" 'BEGIN { printf "GPU burn rate now: ~$%.2f/hour (~$%.0f/month if left running)\n", t, t * 730 }'

    # Endpoints with our prefix that are NOT in the Terraform model list: left
    # over from a renamed/removed model, or started by hand. They still cost money.
    if [ -n "$PREFIX" ] && [ -z "$SLUG" ]; then
      known="$(printf '%s\n' "$MODELS" | cut -f2)"
      strays="$(sm list-endpoints --name-contains "$PREFIX" --query 'Endpoints[].EndpointName' --output text 2>/dev/null | tr '\t' '\n' | grep -vxF "$known" || true)"
      if [ -n "$strays" ]; then
        echo
        echo "Other endpoints named '$PREFIX-*' that no model in Terraform owns (they are billed too):"
        printf '%s\n' "$strays" | sed 's/^/  /'
        echo "Delete one with: ENDPOINT_NAME=<name> $0 stop"
      fi
    fi
    ;;

  stop)
    while IFS=$'\t' read -r slug endpoint _config _instance _rate scaling; do
      [ -n "$slug" ] || continue
      status="$(endpoint_status "$endpoint")"
      if [ "$status" = "NotRunning" ]; then
        echo "$slug: $endpoint is not running."
        continue
      fi
      echo "$slug: deleting endpoint $endpoint ..."
      # SageMaker refuses to delete an endpoint that is still Creating/Updating.
      if sm delete-endpoint --endpoint-name "$endpoint"; then
        echo "   Deleted. Billing stops once deletion completes (about a minute)."
        controller_note "$scaling" stop
      else
        echo "   Could not delete it now (if it is still Creating, wait until it is InService or Failed, then retry)."
      fi
    done <<<"$MODELS"
    ;;

  start)
    [ -n "$SLUG" ] || [ -n "${ENDPOINT_NAME:-}" ] || die "which model? usage: $0 start <model>"
    IFS=$'\t' read -r slug endpoint config _instance rate scaling <<<"$MODELS"
    [ -n "$config" ] || die "no endpoint configuration name (set ENDPOINT_CONFIG_NAME)."
    status="$(endpoint_status "$endpoint")"
    if [ "$status" != "NotRunning" ]; then
      echo "$endpoint already exists (status: $status)."
      exit 0
    fi
    echo "Creating $endpoint from $config ..."
    sm create-endpoint --endpoint-name "$endpoint" --endpoint-config-name "$config" >/dev/null
    awk -v r="$rate" 'BEGIN { if (r > 0) printf "Billing starts now: ~$%.2f/hour.\n", r }'
    controller_note "$scaling" start
    cat <<MSG
It takes 5-15 minutes to become InService (image pull, weight download, model
load). Watch it with:
  $0 status $slug
  aws logs tail /aws/sagemaker/Endpoints/$endpoint --follow --region $REGION
MSG
    ;;

  *)
    sed -n '2,9p' "$0"
    exit 2
    ;;
esac
