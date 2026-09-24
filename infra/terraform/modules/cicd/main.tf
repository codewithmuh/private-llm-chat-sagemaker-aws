# An IAM role that GitHub Actions can assume WITHOUT any AWS keys stored in
# GitHub.
#
# How it works: each workflow run gets a short-lived token signed by GitHub
# (OIDC). AWS trusts GitHub's signing keys (the "OIDC provider" below) and
# swaps a valid token for temporary credentials of this role, but only if the
# token says it comes from YOUR repository (the `sub` condition). A leaked
# credential is useless within the hour.

# ------------------------------------------------------------ oidc provider -
# An account can register token.actions.githubusercontent.com only once. If
# another project already did, set create_github_oidc_provider = false and it
# is looked up instead.

resource "aws_iam_openid_connect_provider" "github" {
  count = var.create_oidc_provider ? 1 : 0

  url            = "https://token.actions.githubusercontent.com"
  client_id_list = ["sts.amazonaws.com"]
  # No thumbprint_list: AWS validates GitHub's certificate against its own
  # trusted CAs, so the thumbprints are optional in provider 6.x.
}

data "aws_iam_openid_connect_provider" "github" {
  count = var.create_oidc_provider ? 0 : 1
  url   = "https://token.actions.githubusercontent.com"
}

locals {
  oidc_provider_arn = var.create_oidc_provider ? aws_iam_openid_connect_provider.github[0].arn : data.aws_iam_openid_connect_provider.github[0].arn
}

# --------------------------------------------------------------------- role -

resource "aws_iam_role" "deploy" {
  name        = "${var.name}-github-deploy"
  description = "Assumed by GitHub Actions in ${var.github_repository} to deploy ${var.name}"

  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect    = "Allow"
      Principal = { Federated = local.oidc_provider_arn }
      Action    = "sts:AssumeRoleWithWebIdentity"
      Condition = {
        StringEquals = {
          "token.actions.githubusercontent.com:aud" = "sts.amazonaws.com"
        }
        # THE important line. Without a `sub` condition, a workflow in ANY
        # GitHub repository in the world could assume this role.
        # A push to main has sub = "repo:<owner>/<repo>:ref:refs/heads/main".
        StringLike = {
          "token.actions.githubusercontent.com:sub" = [
            for s in var.oidc_subjects : "repo:${var.github_repository}:${s}"
          ]
        }
      }
    }]
  })
}

# ------------------------------------------------ build and deploy (always) -

resource "aws_iam_role_policy" "deploy" {
  name = "push-images-and-deploy"
  role = aws_iam_role.deploy.id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Sid      = "EcrLogin"
        Effect   = "Allow"
        Action   = ["ecr:GetAuthorizationToken"]
        Resource = "*"
      },
      {
        Sid    = "PushImages"
        Effect = "Allow"
        Action = [
          "ecr:BatchCheckLayerAvailability",
          "ecr:InitiateLayerUpload",
          "ecr:UploadLayerPart",
          "ecr:CompleteLayerUpload",
          "ecr:PutImage",
          "ecr:BatchGetImage",
          "ecr:GetDownloadUrlForLayer",
          "ecr:DescribeImages",
        ]
        Resource = var.ecr_repository_arns
      },
      {
        # Roll the services and wait for them to settle.
        Sid      = "UpdateServices"
        Effect   = "Allow"
        Action   = ["ecs:DescribeServices", "ecs:UpdateService"]
        Resource = "arn:${var.partition}:ecs:${var.region}:${var.account_id}:service/${var.ecs_cluster_name}/*"
      },
      {
        # These ECS actions do not support resource-level permissions.
        Sid      = "TaskDefinitions"
        Effect   = "Allow"
        Action   = ["ecs:RegisterTaskDefinition", "ecs:DescribeTaskDefinition", "ecs:ListTasks", "ecs:DescribeTasks"]
        Resource = "*"
      },
      {
        # Registering a task definition "passes" its roles to ECS.
        Sid       = "PassTaskRoles"
        Effect    = "Allow"
        Action    = ["iam:PassRole"]
        Resource  = var.pass_role_arns
        Condition = { StringEquals = { "iam:PassedToService" = "ecs-tasks.amazonaws.com" } }
      },
      {
        # Print container logs in the workflow when a deployment fails.
        Sid      = "ReadServiceLogs"
        Effect   = "Allow"
        Action   = ["logs:GetLogEvents", "logs:DescribeLogStreams", "logs:FilterLogEvents"]
        Resource = "arn:${var.partition}:logs:${var.region}:${var.account_id}:log-group:/ecs/${var.name}/*"
      },
    ]
  })
}

# ------------------------------------------------ terraform apply (optional) -
# `terraform apply` creates and changes EVERYTHING in this stack: VPC, RDS,
# CloudFront, IAM roles, SageMaker... A precise least-privilege policy for that
# is long and breaks with every new resource, so this uses AWS's PowerUserAccess
# (everything except IAM and account management) plus IAM limited to roles
# named "<name>-*" and the GitHub OIDC provider.
#
# Be clear about what that means: a role that can create IAM roles and attach
# policies to them can give itself more power. Treat this role as ADMIN of the
# account. Anyone who can push to main (or merge a PR) can change your
# infrastructure. Protect the main branch, or leave this off and run
# terraform from your own machine.

resource "aws_iam_role_policy_attachment" "power_user" {
  count = var.allow_terraform ? 1 : 0

  role       = aws_iam_role.deploy.name
  policy_arn = "arn:${var.partition}:iam::aws:policy/PowerUserAccess"
}

resource "aws_iam_role_policy" "terraform_iam" {
  count = var.allow_terraform ? 1 : 0

  name = "terraform-manage-stack-iam"
  role = aws_iam_role.deploy.id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Sid    = "ManageStackRoles"
        Effect = "Allow"
        Action = [
          "iam:CreateRole", "iam:DeleteRole", "iam:GetRole", "iam:UpdateRole",
          "iam:UpdateRoleDescription", "iam:UpdateAssumeRolePolicy",
          "iam:TagRole", "iam:UntagRole", "iam:ListRoleTags",
          "iam:PutRolePolicy", "iam:GetRolePolicy", "iam:DeleteRolePolicy", "iam:ListRolePolicies",
          "iam:AttachRolePolicy", "iam:DetachRolePolicy", "iam:ListAttachedRolePolicies",
          "iam:ListInstanceProfilesForRole", "iam:PassRole",
        ]
        Resource = "arn:${var.partition}:iam::${var.account_id}:role/${var.name}-*"
      },
      {
        Sid    = "ManageGithubOidcProvider"
        Effect = "Allow"
        Action = [
          "iam:GetOpenIDConnectProvider", "iam:CreateOpenIDConnectProvider",
          "iam:DeleteOpenIDConnectProvider", "iam:TagOpenIDConnectProvider",
          "iam:UntagOpenIDConnectProvider", "iam:UpdateOpenIDConnectProviderThumbprint",
          "iam:AddClientIDToOpenIDConnectProvider", "iam:RemoveClientIDFromOpenIDConnectProvider",
        ]
        Resource = "arn:${var.partition}:iam::${var.account_id}:oidc-provider/token.actions.githubusercontent.com"
      },
      {
        Sid      = "FindOidcProviders"
        Effect   = "Allow"
        Action   = ["iam:ListOpenIDConnectProviders"]
        Resource = "*"
      },
    ]
  })
}
