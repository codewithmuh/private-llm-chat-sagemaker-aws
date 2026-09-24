# Application Load Balancer: receives requests from CloudFront and sends them
# to the right ECS service by URL path.
#
# Two locks keep everybody except CloudFront out:
#   1. Network: the ALB security group only accepts CloudFront's IP ranges
#      (modules/network). But ANY CloudFront distribution, including one an
#      attacker creates in their own account, comes from those IPs.
#   2. A secret header: our distribution adds "X-Origin-Verify: <random>" to
#      every request. Requests without it get a 403 here. Together the two
#      mean the only way in is through our CloudFront, with its HTTPS.
#
# There is only an HTTP listener: CloudFront terminates TLS for the browser and
# talks to the ALB over HTTP inside AWS's network. (Adding HTTPS here would
# need a certificate for a domain that points at the ALB.)

resource "random_password" "origin_verify" {
  length  = 32
  special = false
}

resource "aws_lb" "this" {
  name               = "${var.name}-alb"
  load_balancer_type = "application"
  internal           = false
  security_groups    = [var.security_group_id]
  subnets            = var.public_subnet_ids

  # Chat answers stream as Server-Sent Events and can take minutes. The ALB
  # closes a connection that is silent for longer than this (default 60s).
  # The api also sends ": keep-alive" comments while the model thinks.
  idle_timeout = 300

  # Drop requests with malformed header names instead of passing them on.
  drop_invalid_header_fields = true

  enable_deletion_protection = var.deletion_protection

  tags = { Name = "${var.name}-alb" }
}

# ---------------------------------------------------------- target groups ---
# target_type "ip": Fargate tasks register their own private IP.
#
# Health checks go straight from the ALB to each task, with the task's private
# IP as the Host header (e.g. "10.20.0.37"). Django would reject that host
# (it is not in ALLOWED_HOSTS) with a 400 and the target would never become
# healthy. The backend answers /api/health/ in a middleware that runs BEFORE
# host validation (backend/apps/common/health.py), which is what makes this work.

resource "aws_lb_target_group" "api" {
  name        = "${var.name}-api"
  port        = var.api_port
  protocol    = "HTTP"
  target_type = "ip"
  vpc_id      = var.vpc_id

  # On deploy, a task being replaced gets this long to finish in-flight
  # requests. Short keeps deploys fast; a chat answer still streaming after
  # 30 s is cut off and the user can press "regenerate".
  deregistration_delay = 30

  health_check {
    path                = "/api/health/"
    matcher             = "200"
    interval            = 15
    timeout             = 5
    healthy_threshold   = 2
    unhealthy_threshold = 3
  }

  tags = { Name = "${var.name}-api" }
}

resource "aws_lb_target_group" "web" {
  name                 = "${var.name}-web"
  port                 = var.web_port
  protocol             = "HTTP"
  target_type          = "ip"
  vpc_id               = var.vpc_id
  deregistration_delay = 30

  health_check {
    path                = "/healthz"
    matcher             = "200"
    interval            = 15
    timeout             = 5
    healthy_threshold   = 2
    unhealthy_threshold = 3
  }

  tags = { Name = "${var.name}-web" }
}

# ---------------------------------------------------------------- routing ---

resource "aws_lb_listener" "http" {
  load_balancer_arn = aws_lb.this.arn
  port              = 80
  protocol          = "HTTP"

  # Anything that did not come through our CloudFront distribution.
  default_action {
    type = "fixed-response"
    fixed_response {
      content_type = "text/plain"
      message_body = "Forbidden"
      status_code  = "403"
    }
  }
}

# Rules are checked in priority order (lowest first). ALB limits: at most 3
# values per condition and 5 per rule, so 1 header value + 3 paths fits. A
# fourth API path would need a second rule.
resource "aws_lb_listener_rule" "api" {
  listener_arn = aws_lb_listener.http.arn
  priority     = 10

  action {
    type             = "forward"
    target_group_arn = aws_lb_target_group.api.arn
  }

  condition {
    http_header {
      http_header_name = "X-Origin-Verify"
      values           = [random_password.origin_verify.result]
    }
  }

  condition {
    path_pattern {
      values = ["/api/*", "/admin/*", "/django-static/*"]
    }
  }
}

resource "aws_lb_listener_rule" "web" {
  listener_arn = aws_lb_listener.http.arn
  priority     = 20

  action {
    type             = "forward"
    target_group_arn = aws_lb_target_group.web.arn
  }

  condition {
    http_header {
      http_header_name = "X-Origin-Verify"
      values           = [random_password.origin_verify.result]
    }
  }
}
