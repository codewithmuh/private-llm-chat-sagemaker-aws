# IAM roles for the containers. ECS uses two kinds:
#
#   execution role  used by ECS itself, BEFORE the app starts: pull the image
#                   from ECR, create log streams, read the secrets it injects.
#   task role       used by the app's own code (boto3) while it runs. One per
#                   service, each with only what that service needs.
#
# Keeping them apart means a compromised container cannot use the execution
# role's rights (for example, reading secrets it was not given).

locals {
  execution_assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect    = "Allow"
      Principal = { Service = "ecs-tasks.amazonaws.com" }
      Action    = "sts:AssumeRole"
    }]
  })

  task_assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect    = "Allow"
      Principal = { Service = "ecs-tasks.amazonaws.com" }
      Action    = "sts:AssumeRole"
      # Only ECS tasks of THIS account may assume the role (the "confused
      # deputy" guard AWS recommends for task roles).
      Condition = {
        ArnLike      = { "aws:SourceArn" = "arn:${var.partition}:ecs:${var.region}:${var.account_id}:*" }
        StringEquals = { "aws:SourceAccount" = var.account_id }
      }
    }]
  })

  # ECS Exec opens a shell through SSM Session Manager; the task role needs
  # these four actions (they do not support resource-level scoping).
  ecs_exec_statements = var.enable_execute_command ? [{
    Sid    = "EcsExec"
    Effect = "Allow"
    Action = [
      "ssmmessages:CreateControlChannel",
      "ssmmessages:CreateDataChannel",
      "ssmmessages:OpenControlChannel",
      "ssmmessages:OpenDataChannel",
    ]
    Resource = "*"
  }] : []
}

# ------------------------------------------------------------- execution ----

resource "aws_iam_role" "execution" {
  name               = "${var.name}-ecs-execution"
  assume_role_policy = local.execution_assume_role_policy
}

# AWS's standard policy: pull from ECR and write to CloudWatch Logs.
resource "aws_iam_role_policy_attachment" "execution" {
  role       = aws_iam_role.execution.name
  policy_arn = "arn:${var.partition}:iam::aws:policy/service-role/AmazonECSTaskExecutionRolePolicy"
}

# Read exactly the two secrets injected into the Django containers. They are
# encrypted with the AWS-managed key (aws/secretsmanager), so no kms:Decrypt
# statement is needed; a customer-managed KMS key would need one.
resource "aws_iam_role_policy" "execution_secrets" {
  name = "read-app-secrets"
  role = aws_iam_role.execution.id
  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Sid      = "ReadInjectedSecrets"
      Effect   = "Allow"
      Action   = ["secretsmanager:GetSecretValue"]
      Resource = var.secret_arns
    }]
  })
}

# -------------------------------------------------------------------- api ----

resource "aws_iam_role" "api" {
  name               = "${var.name}-api-task"
  assume_role_policy = local.task_assume_role_policy
}

resource "aws_iam_role_policy" "api" {
  name = "api"
  role = aws_iam_role.api.id
  policy = jsonencode({
    Version = "2012-10-17"
    Statement = concat(
      [
        {
          # Read, write and delete uploaded files, only under the uploads prefix.
          Sid      = "UploadsReadWrite"
          Effect   = "Allow"
          Action   = ["s3:GetObject", "s3:PutObject", "s3:DeleteObject"]
          Resource = "${var.uploads_bucket_arn}/${var.uploads_prefix}*"
        },
        {
          Sid      = "UploadsList"
          Effect   = "Allow"
          Action   = ["s3:ListBucket"]
          Resource = var.uploads_bucket_arn
          Condition = {
            StringLike = { "s3:prefix" = ["${var.uploads_prefix}*"] }
          }
        },
        {
          # Chat with the models (streaming and not), and read endpoint status
          # to show "starting / ready" in the UI. Only this stack's endpoints.
          Sid    = "InvokeLlmEndpoints"
          Effect = "Allow"
          Action = [
            "sagemaker:InvokeEndpoint",
            "sagemaker:InvokeEndpointWithResponseStream",
            "sagemaker:DescribeEndpoint",
          ]
          Resource = var.sagemaker_endpoint_arn_pattern
        },
      ],
      # Sending email. Resource "identity/*" rather than just our sender: while
      # the account is in the SES sandbox, SES also checks the RECIPIENT's
      # identity against this policy, so a sender-only resource fails with
      # "not authorized to perform ses:SendEmail on resource ...identity/<recipient>".
      var.ses_enabled ? [{
        Sid      = "SendEmail"
        Effect   = "Allow"
        Action   = ["ses:SendEmail", "ses:SendRawEmail"]
        Resource = "arn:${var.partition}:ses:${var.region}:${var.account_id}:identity/*"
      }] : [],
      local.ecs_exec_statements,
    )
  })
}

# -------------------------------------------------------------------- web ----
# The web container makes no AWS calls. An empty role (instead of none) keeps
# the three services uniform and gives you a place to add permissions later.

resource "aws_iam_role" "web" {
  name               = "${var.name}-web-task"
  assume_role_policy = local.task_assume_role_policy
}

# --------------------------------------------------------- gpu-controller ----

resource "aws_iam_role" "gpu_controller" {
  name               = "${var.name}-gpu-controller-task"
  assume_role_policy = local.task_assume_role_policy
}

resource "aws_iam_role_policy" "gpu_controller" {
  name = "gpu-controller"
  role = aws_iam_role.gpu_controller.id
  policy = jsonencode({
    Version = "2012-10-17"
    Statement = concat(
      [
        {
          # Start and stop THIS stack's endpoints ("<name>-*") from THIS stack's
          # endpoint configurations. CreateEndpoint is checked against both the
          # endpoint and the configuration ARN; AddTags is needed if the
          # controller tags what it creates; UpdateEndpoint lets it switch a
          # running endpoint to a newer configuration.
          Sid    = "ControlLlmEndpoints"
          Effect = "Allow"
          Action = [
            "sagemaker:CreateEndpoint",
            "sagemaker:DeleteEndpoint",
            "sagemaker:UpdateEndpoint",
            "sagemaker:DescribeEndpoint",
            "sagemaker:DescribeEndpointConfig",
            "sagemaker:AddTags",
          ]
          Resource = [var.sagemaker_endpoint_arn_pattern, var.sagemaker_endpoint_config_arn_pattern]
        },
        {
          # List calls cannot be limited to certain resources.
          Sid      = "ListLlmEndpoints"
          Effect   = "Allow"
          Action   = ["sagemaker:ListEndpoints", "sagemaker:ListEndpointConfigs"]
          Resource = "*"
        },
      ],
      local.ecs_exec_statements,
    )
  })
}
