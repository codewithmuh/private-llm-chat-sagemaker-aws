#!/usr/bin/env bash
# OPTIONAL: create an S3 bucket for the Terraform state.
#
#   ./scripts/bootstrap-state.sh [region] [bucket-name]
#
# You do NOT need this to get started: by default Terraform keeps its state in
# a local file (infra/terraform/terraform.tfstate). You need a state bucket when
#   - GitHub Actions should run `terraform apply` (CI runners are thrown away
#     after each run, so the state must live somewhere shared), or
#   - several people or machines manage the same stack.
#
# Run it once per AWS account. Uses your normal AWS CLI credentials
# (AWS_PROFILE); it never asks for or stores access keys.
set -euo pipefail

REGION="${1:-${AWS_REGION:-$(aws configure get region 2>/dev/null || echo us-east-1)}}"
ACCOUNT_ID="$(aws sts get-caller-identity --query Account --output text)"
BUCKET="${2:-llmchat-tfstate-${ACCOUNT_ID}-${REGION}}"

echo "Account : $ACCOUNT_ID"
echo "Region  : $REGION"
echo "Bucket  : $BUCKET"
read -r -p "Create this state bucket? [y/N] " answer
[ "$answer" = "y" ] || [ "$answer" = "Y" ] || {
  echo "Aborted."
  exit 1
}

if aws s3api head-bucket --bucket "$BUCKET" 2>/dev/null; then
  echo "Bucket already exists; making sure its settings are right."
elif [ "$REGION" = "us-east-1" ]; then
  # us-east-1 is the one region that rejects a LocationConstraint.
  aws s3api create-bucket --bucket "$BUCKET" --region "$REGION" >/dev/null
else
  aws s3api create-bucket --bucket "$BUCKET" --region "$REGION" \
    --create-bucket-configuration "LocationConstraint=$REGION" >/dev/null
fi

# Versioning: every state write keeps the previous version, so a broken or
# accidentally emptied state can be restored from the S3 console.
aws s3api put-bucket-versioning --bucket "$BUCKET" --region "$REGION" \
  --versioning-configuration Status=Enabled

# The state contains secrets (the generated database password, for one).
aws s3api put-bucket-encryption --bucket "$BUCKET" --region "$REGION" \
  --server-side-encryption-configuration \
  '{"Rules":[{"ApplyServerSideEncryptionByDefault":{"SSEAlgorithm":"AES256"}}]}'

aws s3api put-public-access-block --bucket "$BUCKET" --region "$REGION" \
  --public-access-block-configuration \
  BlockPublicAcls=true,IgnorePublicAcls=true,BlockPublicPolicy=true,RestrictPublicBuckets=true

# Refuse plain-HTTP access.
aws s3api put-bucket-policy --bucket "$BUCKET" --region "$REGION" --policy "{
  \"Version\": \"2012-10-17\",
  \"Statement\": [{
    \"Sid\": \"DenyInsecureTransport\",
    \"Effect\": \"Deny\",
    \"Principal\": \"*\",
    \"Action\": \"s3:*\",
    \"Resource\": [\"arn:aws:s3:::$BUCKET\", \"arn:aws:s3:::$BUCKET/*\"],
    \"Condition\": {\"Bool\": {\"aws:SecureTransport\": \"false\"}}
  }]
}"

cat <<MSG

State bucket ready: $BUCKET

Switch Terraform to it (moves your existing local state into the bucket):

  cp infra/terraform/backend.tf.example infra/terraform/backend.tf
  terraform -chdir=infra/terraform init -migrate-state \\
    -backend-config="bucket=$BUCKET" \\
    -backend-config="region=$REGION"

For the GitHub Actions deploy, add these repository VARIABLES
(Settings -> Secrets and variables -> Actions -> Variables):

  TF_STATE_BUCKET = $BUCKET
  AWS_REGION      = <the region of the stack>

MSG
