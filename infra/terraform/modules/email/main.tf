# Sending email (sign-up verification codes, email 2FA codes) with Amazon SES.
#
# Three ways to run:
#   1. Nothing set (default): EMAIL_PROVIDER=console. Emails are NOT sent; the
#      api prints them, codes included, to its CloudWatch log group
#      (/ecs/<name>/api). Fine for trying things out alone, useless for real users.
#   2. from_email = "you@example.com": SES verifies that one address (AWS sends
#      it a link to click). Quickest way to real email.
#   3. domain = "example.com": SES verifies the whole domain with DKIM. Better
#      deliverability; any address @example.com can send.
#
# SES SANDBOX: every new AWS account starts in the SES sandbox. There you can
# only send TO addresses that are themselves verified identities, at most 200
# emails a day. To email real users, request production access (SES console ->
# Account dashboard -> "Request production access"); approval usually takes
# about a day.

locals {
  use_domain  = var.domain != null
  use_address = var.from_email != null && !local.use_domain
  enabled     = local.use_domain || local.use_address

  from_address = coalesce(
    var.from_email,
    local.use_domain ? "no-reply@${var.domain}" : null,
    "no-reply@localhost",
  )
}

resource "aws_sesv2_email_identity" "address" {
  count          = local.use_address ? 1 : 0
  email_identity = var.from_email
}

resource "aws_sesv2_email_identity" "domain" {
  count          = local.use_domain ? 1 : 0
  email_identity = var.domain

  lifecycle {
    precondition {
      condition     = var.from_email == null || endswith(lower(coalesce(var.from_email, "-")), "@${lower(var.domain)}")
      error_message = "ses_from_email must be an address in ses_domain."
    }
  }
}

# DKIM: three CNAME records that let receivers check our emails really come
# from SES on behalf of this domain. Created only if the zone is in Route 53;
# otherwise the ses_dns_records output lists them for your DNS provider.
resource "aws_route53_record" "dkim" {
  count = local.use_domain && var.route53_zone_id != null ? 3 : 0

  zone_id = var.route53_zone_id
  name    = "${aws_sesv2_email_identity.domain[0].dkim_signing_attributes[0].tokens[count.index]}._domainkey.${var.domain}"
  type    = "CNAME"
  ttl     = 1800
  records = ["${aws_sesv2_email_identity.domain[0].dkim_signing_attributes[0].tokens[count.index]}.dkim.amazonses.com"]
}
