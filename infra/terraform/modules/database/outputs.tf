output "address" {
  description = "Host name of the database (DB_HOST)."
  value       = aws_db_instance.this.address
}

output "port" {
  value = aws_db_instance.this.port
}

output "db_name" {
  value = aws_db_instance.this.db_name
}

output "username" {
  value = aws_db_instance.this.username
}

# Taken from the secret VERSION, not the secret: anything that uses this ARN
# (the ECS task definitions) then waits until the password is actually stored.
output "password_secret_arn" {
  description = "Secrets Manager secret holding {\"username\", \"password\"}."
  value       = aws_secretsmanager_secret_version.db.secret_arn
}
