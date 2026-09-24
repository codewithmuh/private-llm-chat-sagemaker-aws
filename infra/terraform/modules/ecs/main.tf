# The application containers on ECS Fargate (serverless containers: no EC2
# machines to manage).
#
#   api             Django + gunicorn on :8000. Behind the ALB (/api/*, /admin/*,
#                   /django-static/*). Runs migrations on start (RUN_BOOTSTRAP).
#   web             Next.js on :3000. Behind the ALB (everything else).
#   gpu-controller  Same image as api, different command. No load balancer.
#                   Every ~30 s it compares each SageMaker model's `scaling`
#                   with reality and creates or deletes endpoints.
#
# All three run on ARM64 (Graviton): about 20% cheaper than x86 on Fargate.
# The images MUST be built for linux/arm64 (scripts/deploy.sh does this). An
# x86 image here pulls fine and then dies with "exec format error".

locals {
  # ECS wants environment variables and secrets as lists of objects. Sorted by
  # name so the task definition JSON is stable and plans show real changes only.
  django_env_list = [
    for k in sort(keys(var.django_environment)) : { name = k, value = var.django_environment[k] }
  ]
  django_secret_list = [
    for k in sort(keys(var.django_secrets)) : { name = k, valueFrom = var.django_secrets[k] }
  ]

  # One helper for the log settings every container shares.
  log_config = {
    for svc in ["api", "web", "gpu-controller"] : svc => {
      logDriver = "awslogs"
      options = {
        "awslogs-group"         = aws_cloudwatch_log_group.this[svc].name
        "awslogs-region"        = var.region
        "awslogs-stream-prefix" = svc
        # If CloudWatch is slow, drop log lines rather than block the app.
        "mode"            = "non-blocking"
        "max-buffer-size" = "25m"
      }
    }
  }
}

resource "aws_ecs_cluster" "this" {
  name = var.name

  # Container Insights adds per-task CPU/memory dashboards but is billed as
  # custom CloudWatch metrics. Off to keep the baseline cheap; switch to
  # "enhanced" when you want the dashboards.
  setting {
    name  = "containerInsights"
    value = "disabled"
  }
}

resource "aws_cloudwatch_log_group" "this" {
  for_each = toset(["api", "web", "gpu-controller"])

  name              = "/ecs/${var.name}/${each.key}"
  retention_in_days = var.log_retention_days
}

# ==================================================================== api ===

resource "aws_ecs_task_definition" "api" {
  family                   = "${var.name}-api"
  requires_compatibilities = ["FARGATE"]
  network_mode             = "awsvpc" # each task gets its own IP (required by Fargate)
  cpu                      = var.api_cpu
  memory                   = var.api_memory
  execution_role_arn       = aws_iam_role.execution.arn
  task_role_arn            = aws_iam_role.api.arn

  runtime_platform {
    operating_system_family = "LINUX"
    cpu_architecture        = "ARM64"
  }

  container_definitions = jsonencode([{
    name      = "api"
    image     = var.api_image
    essential = true
    # No `command`: the image's default CMD starts gunicorn.

    portMappings = [{ containerPort = var.api_port, hostPort = var.api_port, protocol = "tcp" }]

    environment = concat(local.django_env_list, [
      # Only the api migrates the database and syncs LLM_MODELS into it on start
      # (under a Postgres advisory lock, so two api tasks never migrate at once).
      { name = "RUN_BOOTSTRAP", value = "true" },
    ])
    secrets = local.django_secret_list

    logConfiguration = local.log_config["api"]
    # A tiny init process: reaps zombie processes and is recommended for ECS Exec.
    linuxParameters = { initProcessEnabled = true }
    # No container healthCheck: the ALB already checks /api/health/ and ECS
    # replaces tasks that fail it. (A container check would also need curl or
    # similar inside the image.)
  }])
}

resource "aws_ecs_service" "api" {
  name            = "api"
  cluster         = aws_ecs_cluster.this.id
  task_definition = aws_ecs_task_definition.api.arn
  launch_type     = "FARGATE"
  desired_count   = var.run_tasks ? var.api_desired_count : 0

  network_configuration {
    subnets          = var.subnet_ids
    security_groups  = [var.security_group_id]
    assign_public_ip = var.assign_public_ip
  }

  load_balancer {
    target_group_arn = var.api_target_group_arn
    container_name   = "api"
    container_port   = var.api_port
  }

  # Time to migrate and boot before failed health checks count. The first
  # start on an empty database runs every migration.
  health_check_grace_period_seconds = 180

  # A deployment whose new tasks keep failing (bad image, crash on start) is
  # stopped and rolled back to the last working task definition automatically.
  deployment_circuit_breaker {
    enable   = true
    rollback = true
  }

  # ECS Exec: a shell in a running container, e.g.
  #   aws ecs execute-command --cluster <cluster> --task <id> --container api \
  #     --interactive --command "python manage.py createsuperuser"
  enable_execute_command = var.enable_execute_command
  propagate_tags         = "SERVICE"
}

# ==================================================================== web ===

resource "aws_ecs_task_definition" "web" {
  family                   = "${var.name}-web"
  requires_compatibilities = ["FARGATE"]
  network_mode             = "awsvpc"
  cpu                      = var.web_cpu
  memory                   = var.web_memory
  execution_role_arn       = aws_iam_role.execution.arn
  task_role_arn            = aws_iam_role.web.arn

  runtime_platform {
    operating_system_family = "LINUX"
    cpu_architecture        = "ARM64"
  }

  container_definitions = jsonencode([{
    name         = "web"
    image        = var.web_image
    essential    = true
    portMappings = [{ containerPort = var.web_port, hostPort = var.web_port, protocol = "tcp" }]

    # The web app needs almost nothing at run time: it calls /api/ on its own
    # origin and reads everything else from GET /api/config/.
    # NEXT_PUBLIC_API_URL is a BUILD-time setting (baked in by deploy.sh as "").
    environment = [
      { name = "PORT", value = tostring(var.web_port) },
      # Listen on all interfaces, not just the container's hostname, or the
      # ALB health check cannot connect.
      { name = "HOSTNAME", value = "0.0.0.0" },
    ]

    logConfiguration = local.log_config["web"]
    linuxParameters  = { initProcessEnabled = true }
  }])
}

resource "aws_ecs_service" "web" {
  name            = "web"
  cluster         = aws_ecs_cluster.this.id
  task_definition = aws_ecs_task_definition.web.arn
  launch_type     = "FARGATE"
  desired_count   = var.run_tasks ? var.web_desired_count : 0

  network_configuration {
    subnets          = var.subnet_ids
    security_groups  = [var.security_group_id]
    assign_public_ip = var.assign_public_ip
  }

  load_balancer {
    target_group_arn = var.web_target_group_arn
    container_name   = "web"
    container_port   = var.web_port
  }

  health_check_grace_period_seconds = 60

  deployment_circuit_breaker {
    enable   = true
    rollback = true
  }

  propagate_tags = "SERVICE"
}

# ========================================================= gpu-controller ===

resource "aws_ecs_task_definition" "gpu_controller" {
  family                   = "${var.name}-gpu-controller"
  requires_compatibilities = ["FARGATE"]
  network_mode             = "awsvpc"
  cpu                      = var.gpu_controller_cpu
  memory                   = var.gpu_controller_memory
  execution_role_arn       = aws_iam_role.execution.arn
  task_role_arn            = aws_iam_role.gpu_controller.arn

  runtime_platform {
    operating_system_family = "LINUX"
    cpu_architecture        = "ARM64"
  }

  container_definitions = jsonencode([{
    name      = "gpu-controller"
    image     = var.api_image # same image as the api
    essential = true
    command   = ["python", "manage.py", "gpu_controller"]

    # Same settings as the api (it reads LLM_MODELS and the database), but it
    # never migrates: that is the api's job.
    environment = concat(local.django_env_list, [
      { name = "RUN_BOOTSTRAP", value = "false" },
    ])
    secrets = local.django_secret_list

    logConfiguration = local.log_config["gpu-controller"]
    linuxParameters  = { initProcessEnabled = true }
  }])
}

resource "aws_ecs_service" "gpu_controller" {
  name            = "gpu-controller"
  cluster         = aws_ecs_cluster.this.id
  task_definition = aws_ecs_task_definition.gpu_controller.arn
  launch_type     = "FARGATE"
  # Exactly one: two controllers could both decide to create the same endpoint.
  desired_count = var.run_tasks ? 1 : 0

  # During a deploy, stop the old controller BEFORE starting the new one
  # (min 0% / max 100%), so there is never more than one running.
  deployment_minimum_healthy_percent = 0
  deployment_maximum_percent         = 100

  network_configuration {
    subnets          = var.subnet_ids
    security_groups  = [var.security_group_id]
    assign_public_ip = var.assign_public_ip
  }

  deployment_circuit_breaker {
    enable   = true
    rollback = true
  }

  enable_execute_command = var.enable_execute_command
  propagate_tags         = "SERVICE"
}
