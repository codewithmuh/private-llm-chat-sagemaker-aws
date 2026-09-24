# Common tasks. Run `make` (or `make help`) to list them.
SHELL := /bin/bash
.DEFAULT_GOAL := help

COMPOSE     := docker compose
COMPOSE_AWS := docker compose -f docker-compose.yml -f docker-compose.aws.yml
PY          := backend/.venv/bin/python
TF          := terraform -chdir=infra/terraform

.PHONY: help
help: ## Show this help
	@awk 'BEGIN {FS = ":.*?## "} /^[a-zA-Z0-9_-]+:.*?## / {printf "  \033[36m%-18s\033[0m %s\n", $$1, $$2}' $(MAKEFILE_LIST)

# ------------------------------------------------------------- local stack ---

.env:
	cp .env.example .env

.PHONY: up
up: .env ## Start everything locally (web :3000, api :8000, mail :8025)
	$(COMPOSE) up -d --build
	@echo ""
	@echo "  Chat UI     http://localhost:$${WEB_PORT:-3000}"
	@echo "  API         http://localhost:$${API_PORT:-8000}/api/health/"
	@echo "  Emails      http://localhost:$${MAILPIT_PORT:-8025}   (verification codes land here)"

.PHONY: ollama
ollama: .env ## Also run real models locally with Ollama (set LLM_MODELS_FILE=models.ollama.json)
	$(COMPOSE) --profile ollama up -d --build
	@echo "Pulling models in the background: docker compose logs -f ollama-pull"

.PHONY: up-aws
up-aws: .env ## Local app + models on SageMaker (uses ~/.aws and AWS_PROFILE)
	$(COMPOSE_AWS) up -d --build

.PHONY: down
down: ## Stop the local stack (keeps data)
	$(COMPOSE) --profile ollama down

.PHONY: reset
reset: ## Stop and DELETE local data (database, uploads, Ollama models)
	$(COMPOSE) --profile ollama down -v

.PHONY: logs
logs: ## Follow logs of the api and web containers
	$(COMPOSE) logs -f api web

.PHONY: superuser
superuser: ## Create an admin user in the local stack
	$(COMPOSE) exec api python manage.py createsuperuser

# --------------------------------------------------------- backend (local) ---

backend/.venv:
	python3 -m venv backend/.venv
	$(PY) -m pip install -q --upgrade pip
	$(PY) -m pip install -q -r backend/requirements-dev.txt

.PHONY: backend-install
backend-install: backend/.venv ## Create backend/.venv with dev dependencies

.PHONY: backend-dev
backend-dev: backend/.venv ## Run Django on :8000 with SQLite and the in-process mock model (no Docker)
	@# .env (if present) supplies GOOGLE_CLIENT_ID, ADMIN_EMAILS, ...; the
	@# lines after it pin what this no-Docker mode needs.
	set -a; [ -f .env ] && . ./.env; set +a; \
	cd backend && export DATABASE_URL=sqlite:///db.sqlite3 EMAIL_VERIFICATION=none EMAIL_PROVIDER=console \
	  LLM_MODELS_FILE= \
	  LLM_MODELS='[{"id":"mock","name":"Mock (in-process)","provider":"mock","vision":true,"ocr":true,"default":true}]' && \
	  .venv/bin/python manage.py bootstrap && .venv/bin/python manage.py runserver 0.0.0.0:8000

.PHONY: test
test: backend-test frontend-check ## Run all tests and checks

.PHONY: backend-test
backend-test: backend/.venv ## Backend unit tests
	cd backend && .venv/bin/python -m pytest

.PHONY: lint
lint: backend/.venv ## Lint backend (ruff) and frontend (eslint + tsc)
	cd backend && .venv/bin/ruff check . && .venv/bin/ruff format --check .
	cd frontend && npm run lint && npm run typecheck

.PHONY: fmt
fmt: backend/.venv ## Format backend code and Terraform
	cd backend && .venv/bin/ruff format . && .venv/bin/ruff check --fix .
	terraform fmt -recursive infra/terraform

# ---------------------------------------------------------------- frontend ---

frontend/node_modules:
	cd frontend && npm ci

.PHONY: frontend-dev
frontend-dev: frontend/node_modules ## Next.js dev server on :3000 (talks to the api on :8000)
	cd frontend && NEXT_PUBLIC_API_URL=http://localhost:8000 npm run dev

.PHONY: frontend-check
frontend-check: frontend/node_modules ## Typecheck, lint and build the frontend
	cd frontend && npm run typecheck && npm run lint && npm run build

# --------------------------------------------------- a model on SageMaker ---

PRESET ?= qwen3-vl-8b

.PHONY: model-presets
model-presets: ## List ready-made SageMaker model presets
	python3 ml/sagemaker/deploy.py presets

.PHONY: model-deploy
model-deploy: ## Deploy one model to SageMaker (PRESET=qwen3-vl-8b). Costs money while running!
	python3 ml/sagemaker/deploy.py deploy $(PRESET)

.PHONY: model-chat
model-chat: ## Send a test message to the deployed model (PRESET=...)
	python3 ml/sagemaker/deploy.py chat llmchat-$(PRESET) "Say hello in three languages."

.PHONY: model-stop
model-stop: ## Delete the endpoint (stops billing; `make model-start` brings it back)
	python3 ml/sagemaker/deploy.py stop llmchat-$(PRESET)

.PHONY: model-start
model-start: ## Recreate a stopped endpoint
	python3 ml/sagemaker/deploy.py start llmchat-$(PRESET)

.PHONY: model-delete
model-delete: ## Delete endpoint, configuration and model
	python3 ml/sagemaker/deploy.py delete llmchat-$(PRESET)

# ----------------------------------------------------- full stack on AWS ---

.PHONY: tf-init
tf-init: ## terraform init (infra/terraform)
	$(TF) init

.PHONY: tf-plan
tf-plan: ## terraform plan
	$(TF) plan

.PHONY: tf-apply
tf-apply: ## terraform apply
	$(TF) apply

.PHONY: deploy
deploy: ## Build + push images, then roll them out with Terraform
	./scripts/deploy.sh

.PHONY: gpu-status
gpu-status: ## Status and cost of the SageMaker endpoints (full-stack deployment)
	./scripts/gpu.sh status

.PHONY: tf-destroy
tf-destroy: ## Tear down the AWS stack. Stop GPU endpoints first: ./scripts/gpu.sh stop
	$(TF) destroy
