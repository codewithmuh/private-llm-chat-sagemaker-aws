# PostgreSQL on RDS: users, conversations, messages, model settings.
#
# Private subnets only, reachable only from the ECS tasks' security group,
# encrypted at rest, TLS required in transit (DB_SSLMODE=require; RDS for
# PostgreSQL 15+ also sets rds.force_ssl=1 by default).

# ------------------------------------------------------------ password -----
# Why a Terraform-generated password instead of RDS "managed master password"
# (manage_master_user_password = true)?
#
# The managed password is rotated automatically (every 7 days by default).
# ECS injects DB_PASSWORD into a container once, when it starts, so after a
# rotation every running task still holds the old password and every new
# database connection fails until the tasks are restarted. A static password
# avoids that trap for a small app like this. The trade-off: the password
# is stored in the Terraform state, so treat the state as a secret (the S3
# backend encrypts it; a local terraform.tfstate is gitignored).

resource "random_password" "db" {
  length = 40
  # Letters and digits only: nothing that needs escaping in a connection URL or
  # a shell, and nothing RDS rejects ("/", "@", "\"", space).
  special = false
}

resource "aws_secretsmanager_secret" "db" {
  name        = "${var.name}/database"
  description = "Master password of the ${var.name} PostgreSQL database"
  # 0 = delete immediately on destroy, so the stack can be re-created with the
  # same name. Prod keeps a 7-day window to undo an accidental deletion.
  recovery_window_in_days = var.is_prod ? 7 : 0
}

# JSON so ECS can pick one key: valueFrom = "<arn>:password::".
# Host/port are NOT stored here on purpose: they are only known after the
# database exists (~10 minutes), and the secret would then be created late,
# racing the first ECS tasks that need it.
resource "aws_secretsmanager_secret_version" "db" {
  secret_id = aws_secretsmanager_secret.db.id
  secret_string = jsonencode({
    username = var.username
    password = random_password.db.result
  })
}

# ------------------------------------------------------------- instance ----

resource "aws_db_subnet_group" "this" {
  name       = "${var.name}-db"
  subnet_ids = var.subnet_ids
  tags       = { Name = "${var.name}-db" }
}

resource "aws_db_instance" "this" {
  identifier = "${var.name}-db"

  engine = "postgres"
  # Major version only: RDS picks the newest 17.x available in your region and
  # applies minor upgrades in the maintenance window. Pinning an exact minor
  # (e.g. "17.6") breaks in regions where that minor is not offered.
  engine_version             = var.engine_version
  auto_minor_version_upgrade = true
  instance_class             = var.instance_class

  allocated_storage     = var.allocated_storage
  max_allocated_storage = var.allocated_storage * 5 # storage autoscaling ceiling
  storage_type          = "gp3"
  storage_encrypted     = true # with the AWS-managed aws/rds key

  db_name  = var.db_name
  username = var.username
  password = random_password.db.result
  port     = 5432

  db_subnet_group_name   = aws_db_subnet_group.this.name
  vpc_security_group_ids = [var.security_group_id]
  publicly_accessible    = false
  multi_az               = var.multi_az

  backup_retention_period = 7 # point-in-time restore to any second of the last 7 days
  copy_tags_to_snapshot   = true

  # Prod: cannot be deleted by mistake, and a final snapshot is taken if it is.
  # Non-prod: `terraform destroy` removes it cleanly, with no leftover snapshot
  # to pay for.
  deletion_protection       = var.is_prod
  skip_final_snapshot       = !var.is_prod
  final_snapshot_identifier = var.is_prod ? "${var.name}-db-final" : null

  # Non-prod: apply changes (e.g. a new instance class) now, not in the next
  # maintenance window, which is what people expect when they run apply.
  apply_immediately = !var.is_prod

  tags = { Name = "${var.name}-db" }
}
