#!/usr/bin/env bash
# What is running: the app's containers, and the AI model by name. `make status`
# runs this.
#
# With Docker Model Runner (or the Ollama app) the model runs next to Docker, not
# in a container, so `docker ps` doesn't list it. This shows it anyway.
#
# Works with the bash 3.2 that ships with macOS, and in Git Bash on Windows.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

env_get() { # the value of KEY in .env, "" if absent
  if [ -f .env ]; then sed -n "s/^$1=//p" .env | tail -n 1; fi
}

docker info >/dev/null 2>&1 || {
  printf 'Docker is not running. Open Docker Desktop and try again.\n' >&2
  exit 1
}

ENGINE="$(env_get MODEL_ENGINE)"
MODEL="$(env_get LOCAL_MODEL)"
OLLAMA_PORT="$(env_get OLLAMA_PORT)"
OLLAMA_PORT="${OLLAMA_PORT:-11434}"

printf '\nContainers:\n'
CONTAINERS="$(docker ps --filter label=com.docker.compose.project=llmchat \
  --format '{{.Label "com.docker.compose.service"}}\t{{.Status}}')"
if [ -n "$CONTAINERS" ]; then
  printf '%s\n' "$CONTAINERS" | sort | awk -F'\t' '{ printf "  %-16s %s\n", $1, $2 }'
else
  printf '  none. Start the app with: make up\n'
fi

printf '\nAI model:\n'
if [ -z "$MODEL" ] || [ "$MODEL" = mock ]; then
  printf '  the mock model (no AI), in the mock-llm container. Choose a real one with: make model\n'
  exit 0
fi
# "Qwen3-VL 8B (ai/qwen3-vl:8B)": scripts/up.sh writes the default model first.
NAME="$(sed -n 's/^ *"name": "\(.*\)",$/\1/p' config/models.local.json 2>/dev/null | head -n 1)"
LABEL="${NAME:+$NAME (}$MODEL${NAME:+)}"
case "$ENGINE" in
  docker-model-runner)
    printf '  %s, in Docker Model Runner on your GPU.\n' "$LABEL"
    printf '  Docker Desktop runs it next to the containers, so docker ps does not list it.\n'
    case "$(docker model status 2>/dev/null)" in
      *"is running"*) ;;
      *)
        printf '  Docker Model Runner is switched off. Turn it on: docker desktop enable model-runner\n'
        exit 0
        ;;
    esac
    # `docker model ps` names ai/qwen3-vl:8B "qwen3-vl:8b".
    LOADED="$(docker model ps 2>/dev/null || true)"
    case "$(printf '%s' "$LOADED" | tr 'A-Z' 'a-z')" in
      *"$(printf '%s' "${MODEL#ai/}" | tr 'A-Z' 'a-z')"*)
        printf '\n'
        printf '%s\n' "$LOADED" | sed 's/^/  /'
        ;;
      *) printf '  Not in memory right now: it loads by itself with the next message.\n' ;;
    esac
    ;;
  ollama)
    printf '  %s, in the ollama container (CPU).\n\n' "$LABEL"
    docker compose exec -T ollama ollama ps 2>/dev/null | sed 's/^/  /' ||
      printf '  The ollama container is not running. Start it with: make up\n'
    ;;
  ollama-app)
    printf '  %s, in the Ollama app on your computer.\n' "$LABEL"
    curl -fs -m 3 "http://localhost:$OLLAMA_PORT/api/version" >/dev/null 2>&1 ||
      printf '  The Ollama app is not running. Open it, then: make up\n'
    ;;
  *) printf '  %s (MODEL_ENGINE=%s in .env)\n' "$LABEL" "$ENGINE" ;;
esac
