# Private image registries for the images this project builds:
#   <name>/api          Django (api + gpu-controller)       built from backend/
#   <name>/web          Next.js                              built from frontend/
#   <name>/vllm-router  optional multi-model vLLM image      built from ml/vllm-router/
#
# The default LLM container (AWS's vLLM Deep Learning Container) lives in AWS's
# own registry; SageMaker pulls it from there, so nothing 10 GB has to be pushed.

resource "aws_ecr_repository" "this" {
  for_each = toset(var.repositories)

  name = "${var.name}/${each.value}"

  # MUTABLE in dev, so re-running a deploy for the same commit can overwrite
  # the tag. IMMUTABLE in prod: a tag, once pushed, can never point at
  # different bytes, so "which code is running?" always has one answer.
  image_tag_mutability = var.immutable_tags ? "IMMUTABLE" : "MUTABLE"

  # Non-prod: `terraform destroy` deletes the repository even if it holds images.
  force_delete = var.force_delete

  # Free basic vulnerability scan of every pushed image (ECR console -> Images).
  image_scanning_configuration {
    scan_on_push = true
  }
}

# Images cost $0.10 per GB-month. Keep the newest N and delete the rest,
# otherwise every deploy adds another few hundred MB forever.
resource "aws_ecr_lifecycle_policy" "this" {
  for_each   = aws_ecr_repository.this
  repository = each.value.name

  policy = jsonencode({
    rules = [{
      rulePriority = 1
      description  = "Keep the last ${var.keep_images} images"
      selection = {
        tagStatus   = "any"
        countType   = "imageCountMoreThan"
        countNumber = var.keep_images
      }
      action = { type = "expire" }
    }]
  })
}
