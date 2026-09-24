# One LLM_MODELS entry per model, in the schema of docs/configuration.md.
# The root module JSON-encodes this list into the api's LLM_MODELS variable,
# and `python manage.py sync_models` (RUN_BOOTSTRAP) loads it into the database.
output "llm_models" {
  value = [
    for index, slug in sort(keys(var.models)) : merge(
      {
        id          = slug
        name        = var.models[slug].name
        description = var.models[slug].description
        provider    = "sagemaker"
        # What the backend sends as "model" in each request; the container
        # serves the model under this name (SM_VLLM_SERVED_MODEL_NAME).
        model_id = var.models[slug].hf_model_id

        endpoint_name = local.endpoint_names[slug]
        # A reference to the resource (not just the computed name), so the api
        # is only told about a configuration that already exists.
        endpoint_config_name = aws_sagemaker_endpoint_configuration.this[slug].name
        region               = var.region
        scaling              = var.models[slug].scaling
        idle_minutes         = var.models[slug].idle_minutes
        hourly_cost_usd      = var.models[slug].hourly_cost_usd

        vision            = var.models[slug].vision
        ocr               = var.models[slug].ocr
        context_window    = var.models[slug].max_model_len
        max_output_tokens = var.models[slug].max_output_tokens
        default           = var.models[slug].default
        # Display order: explicit sort, else alphabetical by slug (10, 20, 30...).
        sort    = coalesce(var.models[slug].sort, (index + 1) * 10)
        enabled = var.models[slug].enabled
      },
      # Only present when set, so the backend's own default applies otherwise.
      var.models[slug].temperature == null ? {} : { temperature = var.models[slug].temperature },
    )
  ]
}

output "endpoints" {
  description = "Per model: the names scripts/gpu.sh and the GPU controller use."
  value = {
    for slug, m in var.models : slug => {
      endpoint_name        = local.endpoint_names[slug]
      endpoint_config_name = aws_sagemaker_endpoint_configuration.this[slug].name
      model_name           = aws_sagemaker_model.this[slug].name
      instance_type        = m.instance_type
      hourly_cost_usd      = m.hourly_cost_usd
      scaling              = m.scaling
      log_group            = aws_cloudwatch_log_group.endpoint[slug].name
    }
  }
}

# IAM resource patterns for the app's roles. SageMaker ARNs always use the
# lowercase form of the name; our names are lowercase already.
output "endpoint_arn_pattern" {
  value = "arn:${var.partition}:sagemaker:${var.region}:${var.account_id}:endpoint/${var.name}-*"
}

output "endpoint_config_arn_pattern" {
  value = "arn:${var.partition}:sagemaker:${var.region}:${var.account_id}:endpoint-config/${var.name}-*"
}

output "execution_role_arn" {
  value = aws_iam_role.execution.arn
}
