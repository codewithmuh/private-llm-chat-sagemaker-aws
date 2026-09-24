# Security policy

## Reporting a vulnerability

Please **do not open a public issue** for security problems.

Use GitHub's private reporting instead: **Security → Report a vulnerability** on this
repository. Include what you found, how to reproduce it, and what an attacker could do
with it. You'll get an answer within a week.

## Scope

In scope: the application code in this repository (backend, frontend, model
containers) and the Terraform, when used as documented.

Out of scope: vulnerabilities in the models themselves (prompt injection, jailbreaks,
hallucinations), in upstream projects (vLLM, Django, Next.js; report those upstream),
and misconfigurations that the docs warn against.

## Things this project does on purpose

- Sessions are `HttpOnly` cookies with CSRF protection; no tokens in `localStorage`.
- Passwords are hashed by Django (PBKDF2); one-time codes and recovery codes are stored
  as keyed hashes; each emailed code allows 5 attempts and expires after 15 minutes.
- Two-factor authentication (authenticator app or email) also applies to the Django
  admin: `/admin/login/` sends you through the app's login.
- The SageMaker endpoint is reachable only through the AWS API with IAM credentials;
  SageMaker Data Capture (which would copy every prompt to S3) is never enabled.
- Uploaded files are private (S3 bucket with public access blocked, presigned links
  that expire in 5 minutes); only images and PDFs are ever shown inline.
- Prompts and answers are never written to logs.
