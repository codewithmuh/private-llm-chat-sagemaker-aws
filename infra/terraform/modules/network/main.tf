# The network: one VPC across two Availability Zones (AZs), and the security
# groups that decide who may talk to whom.
#
#   public subnets  (one per AZ) : the load balancer, and the ECS tasks in the
#                                  default no-NAT mode; the NAT gateway if enabled
#   private subnets (one per AZ) : the database, the ECS tasks when
#                                  enable_nat_gateway = true, and the SageMaker
#                                  endpoints when they are VPC-isolated
#
# Two AZs because an ALB and an RDS subnet group both require subnets in at
# least two AZs, even when only one task or one database instance runs.

data "aws_availability_zones" "available" {
  state = "available"

  # Only the regular AZs, not Local Zones or Wavelength Zones you may have
  # opted into: those do not support every service used here.
  filter {
    name   = "opt-in-status"
    values = ["opt-in-not-required"]
  }
}

locals {
  azs = slice(data.aws_availability_zones.available.names, 0, 2)
}

resource "aws_vpc" "this" {
  cidr_block = var.vpc_cidr
  # Both needed for RDS endpoint names and VPC interface endpoints to resolve.
  enable_dns_support   = true
  enable_dns_hostnames = true

  tags = { Name = "${var.name}-vpc" }
}

resource "aws_internet_gateway" "this" {
  vpc_id = aws_vpc.this.id
  tags   = { Name = "${var.name}-igw" }
}

# ---------------------------------------------------------------- subnets ---
# /24 each (251 usable IPs): 10.20.0.0/24, 10.20.1.0/24 public and
# 10.20.10.0/24, 10.20.11.0/24 private with the default vpc_cidr.

resource "aws_subnet" "public" {
  count = length(local.azs)

  vpc_id            = aws_vpc.this.id
  cidr_block        = cidrsubnet(var.vpc_cidr, 8, count.index)
  availability_zone = local.azs[count.index]
  # No automatic public IPs: the ALB gets its own, and ECS asks for one per
  # task explicitly (assign_public_ip) only in the no-NAT mode.
  map_public_ip_on_launch = false

  tags = { Name = "${var.name}-public-${local.azs[count.index]}", Tier = "public" }
}

resource "aws_subnet" "private" {
  count = length(local.azs)

  vpc_id            = aws_vpc.this.id
  cidr_block        = cidrsubnet(var.vpc_cidr, 8, count.index + 10)
  availability_zone = local.azs[count.index]

  tags = { Name = "${var.name}-private-${local.azs[count.index]}", Tier = "private" }
}

# ---------------------------------------------------------------- routing ---

resource "aws_route_table" "public" {
  vpc_id = aws_vpc.this.id
  tags   = { Name = "${var.name}-public" }
}

resource "aws_route" "public_internet" {
  route_table_id         = aws_route_table.public.id
  destination_cidr_block = "0.0.0.0/0"
  gateway_id             = aws_internet_gateway.this.id
}

resource "aws_route_table_association" "public" {
  count          = length(aws_subnet.public)
  subnet_id      = aws_subnet.public[count.index].id
  route_table_id = aws_route_table.public.id
}

# Private subnets have NO route to the internet unless the NAT gateway is on.
# The database never needs one.
resource "aws_route_table" "private" {
  vpc_id = aws_vpc.this.id
  tags   = { Name = "${var.name}-private" }
}

resource "aws_route_table_association" "private" {
  count          = length(aws_subnet.private)
  subnet_id      = aws_subnet.private[count.index].id
  route_table_id = aws_route_table.private.id
}

# ------------------------------------------------------------- nat (opt) ----
# One NAT gateway in the first AZ. Cheaper than one per AZ; if that AZ fails,
# tasks in the other AZ lose outbound access until it recovers. Fine for most
# deployments of this app; use one NAT per AZ if you need more.

resource "aws_eip" "nat" {
  count  = var.enable_nat_gateway ? 1 : 0
  domain = "vpc"
  tags   = { Name = "${var.name}-nat" }
}

resource "aws_nat_gateway" "this" {
  count = var.enable_nat_gateway ? 1 : 0

  allocation_id = aws_eip.nat[0].id
  subnet_id     = aws_subnet.public[0].id
  tags          = { Name = "${var.name}-nat" }

  depends_on = [aws_internet_gateway.this]
}

resource "aws_route" "private_nat" {
  count = var.enable_nat_gateway ? 1 : 0

  route_table_id         = aws_route_table.private.id
  destination_cidr_block = "0.0.0.0/0"
  nat_gateway_id         = aws_nat_gateway.this[0].id
}

# ------------------------------------------------------- s3 gateway endpoint -
# Free. S3 traffic from the VPC goes straight to S3 instead of through the NAT
# gateway (which charges per GB) or the internet. The isolated SageMaker mode
# depends on it to download model weights.

resource "aws_vpc_endpoint" "s3" {
  vpc_id            = aws_vpc.this.id
  service_name      = "com.amazonaws.${var.region}.s3"
  vpc_endpoint_type = "Gateway"
  route_table_ids   = [aws_route_table.public.id, aws_route_table.private.id]

  tags = { Name = "${var.name}-s3" }
}

# ========================================================= security groups ==
# Read these as a list of allowed connections:
#
#   CloudFront edge servers --80--> alb
#   alb                     --8000 (api), 3000 (web)--> app (ECS tasks)
#   app                     --5432--> db
#   app                     --any--> internet / AWS APIs (SageMaker, S3, SES, ECR...)
#
# Everything else is denied. The rules are separate resources (not inline
# blocks) so each one is visible on its own in `terraform plan`.

# CloudFront's origin-facing IP ranges, as an AWS-managed prefix list. Using it
# means only CloudFront can open connections to the ALB. It counts as ~55
# entries against the security group's rule quota (60 by default), so do not
# add many more rules to the ALB security group.
data "aws_ec2_managed_prefix_list" "cloudfront" {
  name = "com.amazonaws.global.cloudfront.origin-facing"
}

resource "aws_security_group" "alb" {
  name        = "${var.name}-alb"
  description = "Load balancer: HTTP from CloudFront only"
  vpc_id      = aws_vpc.this.id
  tags        = { Name = "${var.name}-alb" }
}

resource "aws_vpc_security_group_ingress_rule" "alb_from_cloudfront" {
  security_group_id = aws_security_group.alb.id
  description       = "HTTP from CloudFront edge servers"
  ip_protocol       = "tcp"
  from_port         = 80
  to_port           = 80
  prefix_list_id    = data.aws_ec2_managed_prefix_list.cloudfront.id
}

resource "aws_security_group" "app" {
  name        = "${var.name}-app"
  description = "ECS tasks: api, web, gpu-controller"
  vpc_id      = aws_vpc.this.id
  tags        = { Name = "${var.name}-app" }
}

locals {
  app_ports = { api = var.api_port, web = var.web_port }
}

resource "aws_vpc_security_group_egress_rule" "alb_to_app" {
  for_each = local.app_ports

  security_group_id            = aws_security_group.alb.id
  description                  = "Requests and health checks to the ${each.key} tasks"
  ip_protocol                  = "tcp"
  from_port                    = each.value
  to_port                      = each.value
  referenced_security_group_id = aws_security_group.app.id
}

resource "aws_vpc_security_group_ingress_rule" "app_from_alb" {
  for_each = local.app_ports

  security_group_id            = aws_security_group.app.id
  description                  = "${each.key} traffic from the load balancer"
  ip_protocol                  = "tcp"
  from_port                    = each.value
  to_port                      = each.value
  referenced_security_group_id = aws_security_group.alb.id
}

# The tasks call AWS APIs (SageMaker, S3, SES, Secrets Manager, ECR, logs) and
# Google (to verify "Sign in with Google" tokens), all over the internet or
# the NAT gateway. Outbound is therefore open; inbound is what matters.
resource "aws_vpc_security_group_egress_rule" "app_all" {
  security_group_id = aws_security_group.app.id
  description       = "Outbound to AWS APIs and the internet"
  ip_protocol       = "-1"
  cidr_ipv4         = "0.0.0.0/0"
}

resource "aws_security_group" "db" {
  name        = "${var.name}-db"
  description = "PostgreSQL: only from the ECS tasks"
  vpc_id      = aws_vpc.this.id
  tags        = { Name = "${var.name}-db" }
}

resource "aws_vpc_security_group_ingress_rule" "db_from_app" {
  security_group_id            = aws_security_group.db.id
  description                  = "PostgreSQL from the ECS tasks"
  ip_protocol                  = "tcp"
  from_port                    = 5432
  to_port                      = 5432
  referenced_security_group_id = aws_security_group.app.id
}
