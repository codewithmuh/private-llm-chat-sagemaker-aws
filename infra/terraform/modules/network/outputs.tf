output "vpc_id" {
  value = aws_vpc.this.id
}

output "vpc_cidr" {
  value = aws_vpc.this.cidr_block
}

output "public_subnet_ids" {
  value = aws_subnet.public[*].id
}

output "private_subnet_ids" {
  value = aws_subnet.private[*].id
}

# Where the ECS tasks run. Without a NAT gateway a task in a private subnet
# could not pull its image or reach any AWS API, so it goes in a public subnet
# with a public IP (and a security group that only admits the ALB).
output "app_subnet_ids" {
  value = var.enable_nat_gateway ? aws_subnet.private[*].id : aws_subnet.public[*].id
}

output "app_subnets_are_public" {
  description = "true = ECS tasks need assign_public_ip."
  value       = !var.enable_nat_gateway
}

output "s3_prefix_list_id" {
  description = "Prefix list of the S3 gateway endpoint, for security group egress rules."
  value       = aws_vpc_endpoint.s3.prefix_list_id
}

output "alb_security_group_id" {
  value = aws_security_group.alb.id
}

output "app_security_group_id" {
  value = aws_security_group.app.id
}

output "db_security_group_id" {
  value = aws_security_group.db.id
}
