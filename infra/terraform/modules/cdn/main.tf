# CloudFront in front of the ALB.
#
# What it gives us:
#   - HTTPS with a free certificate (the *.cloudfront.net one, or ACM for your
#     own domain), so there is no certificate to manage on the ALB.
#   - One origin for the browser: /api/* and the web app share a domain, so
#     session cookies and CSRF need no cross-origin setup.
#   - Edge caching for the static files that never change (/_next/static/*,
#     /django-static/*). Everything else passes through uncached.
#
# SSE streaming note: CloudFront gives up on an origin that sends nothing for
# origin_read_timeout seconds (60 is the maximum without a quota increase).
# The api sends ": keep-alive" comments during long pauses to stay under it.

terraform {
  required_providers {
    aws = {
      source = "hashicorp/aws"
      # The certificate must be created in us-east-1 (see versions.tf).
      configuration_aliases = [aws.us_east_1]
    }
  }
}

# AWS-managed policies, looked up by name (their ids are fixed and documented,
# but a name says what it does):
#   CachingDisabled                       4135ea2d-6df8-44a3-9df3-4b5a84be39ad
#   CachingOptimized                      658327ea-f89d-4fab-a63d-7e88639e58f6
#   AllViewerAndCloudFrontHeaders-2022-06 33f36d7e-f396-46d9-90e0-52428a34d9dc
data "aws_cloudfront_cache_policy" "disabled" {
  name = "Managed-CachingDisabled"
}

data "aws_cloudfront_cache_policy" "optimized" {
  name = "Managed-CachingOptimized"
}

# Forwards every viewer header, cookie and query string, plus CloudFront's own
# headers. Two of them matter to Django:
#   Host                        -> must match ALLOWED_HOSTS (the app's domain,
#                                  not the ALB's name)
#   CloudFront-Forwarded-Proto  -> "https"; Django trusts it via
#                                  PROXY_SSL_HEADER, so it knows the browser
#                                  used HTTPS (secure cookies, redirects, CSRF).
data "aws_cloudfront_origin_request_policy" "all_viewer" {
  name = "Managed-AllViewerAndCloudFrontHeaders-2022-06"
}

locals {
  custom_domain = var.domain_name != null
  origin_id     = "alb"
}

# ------------------------------------------------- certificate (optional) ---

resource "aws_acm_certificate" "this" {
  count    = local.custom_domain ? 1 : 0
  provider = aws.us_east_1

  domain_name       = var.domain_name
  validation_method = "DNS"

  lifecycle {
    create_before_destroy = true
  }
}

# ACM proves you own the domain by looking for a CNAME record it chose.
# The certificate covers exactly one name, so there is exactly one record. Its
# count is fixed in the configuration (not derived from the certificate's
# validation options, which only exist once the certificate does), so
# `terraform plan` always knows how many records it will create.
locals {
  validation_option = local.custom_domain ? one([
    for o in aws_acm_certificate.this[0].domain_validation_options : o if o.domain_name == var.domain_name
  ]) : null
}

resource "aws_route53_record" "validation" {
  count = local.custom_domain ? 1 : 0

  zone_id         = var.route53_zone_id
  name            = local.validation_option.resource_record_name
  type            = local.validation_option.resource_record_type
  records         = [local.validation_option.resource_record_value]
  ttl             = 300
  allow_overwrite = true
}

# Waits (usually 1-5 minutes) until ACM has seen the record and issued the
# certificate. CloudFront rejects a certificate that is not issued yet.
resource "aws_acm_certificate_validation" "this" {
  count    = local.custom_domain ? 1 : 0
  provider = aws.us_east_1

  certificate_arn         = aws_acm_certificate.this[0].arn
  validation_record_fqdns = aws_route53_record.validation[*].fqdn
}

# ---------------------------------------------------------- distribution ----

resource "aws_cloudfront_distribution" "this" {
  enabled         = true
  comment         = "${var.name}: Private LLM Chat"
  is_ipv6_enabled = true
  http_version    = "http2and3"
  price_class     = var.price_class
  aliases         = local.custom_domain ? [var.domain_name] : []

  origin {
    origin_id   = local.origin_id
    domain_name = var.alb_dns_name

    custom_origin_config {
      http_port  = 80
      https_port = 443
      # CloudFront -> ALB over HTTP (the ALB has no certificate). The browser
      # -> CloudFront leg is always HTTPS (viewer_protocol_policy below).
      origin_protocol_policy = "http-only"
      origin_ssl_protocols   = ["TLSv1.2"] # required by the API, unused with http-only
      # Seconds CloudFront waits for the first byte, and between two chunks
      # of a streamed answer. 60 is the most allowed without a quota increase.
      origin_read_timeout      = 60
      origin_keepalive_timeout = 60
    }

    # The shared secret the ALB checks (see modules/alb). If a viewer sends a
    # header with this name, CloudFront overwrites it with this value.
    custom_header {
      name  = "X-Origin-Verify"
      value = var.origin_verify_secret
    }
  }

  # Everything by default: the web app pages and the whole API. Never cached;
  # all methods (POST, PATCH, DELETE...) allowed.
  default_cache_behavior {
    target_origin_id         = local.origin_id
    viewer_protocol_policy   = "redirect-to-https"
    allowed_methods          = ["GET", "HEAD", "OPTIONS", "PUT", "POST", "PATCH", "DELETE"]
    cached_methods           = ["GET", "HEAD"]
    cache_policy_id          = data.aws_cloudfront_cache_policy.disabled.id
    origin_request_policy_id = data.aws_cloudfront_origin_request_policy.all_viewer.id
    # Off: compressing a response can mean buffering it, which is the opposite
    # of what a token-by-token SSE stream needs. (Next.js and Django can
    # compress their own responses.)
    compress = false
  }

  # Next.js build output: file names contain a content hash, so they can be
  # cached for a year safely.
  ordered_cache_behavior {
    path_pattern             = "/_next/static/*"
    target_origin_id         = local.origin_id
    viewer_protocol_policy   = "redirect-to-https"
    allowed_methods          = ["GET", "HEAD", "OPTIONS"]
    cached_methods           = ["GET", "HEAD"]
    cache_policy_id          = data.aws_cloudfront_cache_policy.optimized.id
    origin_request_policy_id = data.aws_cloudfront_origin_request_policy.all_viewer.id
    compress                 = true
  }

  # Django admin CSS/JS. The origin request policy is here too, so a cache miss
  # still reaches Django with the right Host and protocol headers (otherwise
  # Django would see the ALB's host name and answer 400).
  ordered_cache_behavior {
    path_pattern             = "/django-static/*"
    target_origin_id         = local.origin_id
    viewer_protocol_policy   = "redirect-to-https"
    allowed_methods          = ["GET", "HEAD", "OPTIONS"]
    cached_methods           = ["GET", "HEAD"]
    cache_policy_id          = data.aws_cloudfront_cache_policy.optimized.id
    origin_request_policy_id = data.aws_cloudfront_origin_request_policy.all_viewer.id
    compress                 = true
  }

  restrictions {
    geo_restriction {
      restriction_type = "none"
    }
  }

  viewer_certificate {
    # Without a custom domain: the shared *.cloudfront.net certificate.
    cloudfront_default_certificate = !local.custom_domain
    acm_certificate_arn            = local.custom_domain ? aws_acm_certificate_validation.this[0].certificate_arn : null
    ssl_support_method             = local.custom_domain ? "sni-only" : null
    minimum_protocol_version       = local.custom_domain ? "TLSv1.2_2021" : null
  }

  tags = { Name = "${var.name}-cdn" }
}

# ------------------------------------------------------------ dns records ---
# chat.example.com -> the distribution. "Alias" records are free and work at
# the zone apex too. AAAA because IPv6 is enabled above.

resource "aws_route53_record" "alias" {
  for_each = local.custom_domain ? toset(["A", "AAAA"]) : toset([])

  zone_id = var.route53_zone_id
  name    = var.domain_name
  type    = each.value

  alias {
    name                   = aws_cloudfront_distribution.this.domain_name
    zone_id                = aws_cloudfront_distribution.this.hosted_zone_id
    evaluate_target_health = false
  }
}
