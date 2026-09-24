# Terraform and provider versions.
#
# The lock file next to this one (.terraform.lock.hcl) pins the exact provider
# builds that were tested. Commit it: it makes `terraform init` on another
# machine download exactly the same providers.

terraform {
  # 1.9 is the minimum because variables.tf uses validation rules that look at
  # more than one variable (added in Terraform 1.9).
  # Remote state with `use_lockfile` (backend.tf.example) needs 1.10 or newer.
  required_version = ">= 1.9.0"

  required_providers {
    aws = {
      source = "hashicorp/aws"
      # Tested with 6.66.0. Provider 6.x renamed a few attributes compared to
      # 5.x (for example data.aws_region.current.name -> .region); this code
      # already uses the 6.x names.
      version = "~> 6.0"
    }
    random = {
      source  = "hashicorp/random"
      version = "~> 3.7"
    }
  }

  # No `backend` block here on purpose: by default the state is a LOCAL file
  # (terraform.tfstate in this folder). That is the simplest start. To keep the
  # state in S3 instead (needed for the GitHub Actions deploy), see
  # backend.tf.example and scripts/bootstrap-state.sh.
}

# Credentials are NOT configured here. The provider uses the normal AWS chain:
#   export AWS_PROFILE=my-profile      (a profile from `aws configure` / SSO)
# Never put access keys in any file in this repository.
provider "aws" {
  region = var.aws_region

  # Every resource gets these tags, which makes the stack easy to find in the
  # console and in Cost Explorer (Billing -> Cost allocation tags -> activate
  # "Project" to see this stack's cost on its own).
  default_tags {
    tags = local.default_tags
  }
}

# CloudFront only accepts TLS certificates from ACM in us-east-1, whatever
# region the rest of the stack runs in. This second provider exists only for
# that certificate (used when you set domain_name).
provider "aws" {
  alias  = "us_east_1"
  region = "us-east-1"

  default_tags {
    tags = local.default_tags
  }
}
