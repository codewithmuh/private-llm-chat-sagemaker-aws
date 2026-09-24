# The uploads bucket: documents and images users attach to chats.
#
# Private in every way. The browser never talks to S3: files go through the
# API (POST /api/files/), which checks the user, the type and the size first.
# That is why there is no CORS configuration and no presigned upload URL.

resource "aws_s3_bucket" "uploads" {
  # Bucket names are global across all AWS accounts; the account id makes this
  # one unique without guessing.
  bucket = "${var.name}-uploads-${var.account_id}"

  # Non-prod: `terraform destroy` empties and deletes the bucket.
  # Prod: destroy fails while files remain, so user data is never lost by accident.
  force_destroy = var.force_destroy
}

resource "aws_s3_bucket_public_access_block" "uploads" {
  bucket = aws_s3_bucket.uploads.id

  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}

# ACLs off: only IAM policies decide access, and the bucket owner owns every object.
resource "aws_s3_bucket_ownership_controls" "uploads" {
  bucket = aws_s3_bucket.uploads.id
  rule {
    object_ownership = "BucketOwnerEnforced"
  }
}

# SSE-S3 (AES-256 with keys S3 manages). A customer-managed KMS key would add
# per-request KMS charges and key policy work for no real gain in this app.
resource "aws_s3_bucket_server_side_encryption_configuration" "uploads" {
  bucket = aws_s3_bucket.uploads.id
  rule {
    apply_server_side_encryption_by_default {
      sse_algorithm = "AES256"
    }
  }
}

# Versioning is deliberately NOT enabled. With versioning, deleting a file only
# adds a "delete marker" and the bytes stay (and are billed) forever. When a
# user deletes a chat, its files should really be gone.

resource "aws_s3_bucket_lifecycle_configuration" "uploads" {
  bucket = aws_s3_bucket.uploads.id

  # A multipart upload that never completes leaves invisible parts that you
  # still pay for. Clean them up after a day.
  rule {
    id     = "abort-incomplete-multipart-uploads"
    status = "Enabled"
    filter {}
    abort_incomplete_multipart_upload {
      days_after_initiation = 1
    }
  }

  # Optional retention limit for uploaded files.
  dynamic "rule" {
    for_each = var.expiration_days > 0 ? [1] : []
    content {
      id     = "expire-uploads"
      status = "Enabled"
      filter {
        prefix = var.uploads_prefix
      }
      expiration {
        days = var.expiration_days
      }
    }
  }
}

# Refuse any request that is not HTTPS.
resource "aws_s3_bucket_policy" "uploads" {
  bucket = aws_s3_bucket.uploads.id
  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Sid       = "DenyInsecureTransport"
      Effect    = "Deny"
      Principal = "*"
      Action    = "s3:*"
      Resource  = [aws_s3_bucket.uploads.arn, "${aws_s3_bucket.uploads.arn}/*"]
      Condition = { Bool = { "aws:SecureTransport" = "false" } }
    }]
  })

  # S3 rejects two configuration changes on one bucket at the same moment
  # ("OperationAborted: A conflicting conditional operation is currently in
  # progress"). Ordering them avoids that intermittent first-apply failure.
  depends_on = [aws_s3_bucket_public_access_block.uploads]
}
