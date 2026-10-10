#!/usr/bin/env bash
# Start the app on your computer with a real AI model. `make up` runs this.
#
#   ./scripts/up.sh                       start everything (the first time: pick a model)
#   ./scripts/up.sh --choose              pick another model (`make model`)
#   MODEL=llama3.2:3b ./scripts/up.sh     pick without the menu; MODEL=mock for no AI
#
# The first run asks which open-source model to use, downloads it once (2-6 GB),
# and writes config/models.local.json so the app offers it. Later runs reuse it.
# Every downloaded model from the menu shows up in the app's model picker.
#
# The model runs in Ollama (https://ollama.com), which speaks the same
# OpenAI-style API as vLLM on SageMaker, so the app code is the same:
#   - the Ollama app on your computer, if it is running: fastest, it uses your
#     GPU or Apple silicon;
#   - otherwise Ollama in a Docker container: nothing to install, CPU only.
#
# The choices are kept in .env: LOCAL_MODEL, LLM_MODELS_FILE and
# COMPOSE_PROFILES ("ollama" makes `docker compose up` start Ollama too).
#
# Works with the bash 3.2 that ships with macOS, and in Git Bash on Windows.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

ENV_FILE=".env"
MODELS_FILE="models.local.json"   # in config/, which the api container reads
CHOOSE=false
[ "${1:-}" = "--choose" ] && CHOOSE=true

# The menu. One model per line:
#   Ollama name | name in the app | download size (GB) | understands images | good for
CATALOG='qwen3-vl:4b-instruct|Qwen3-VL 4B|3.3|yes|chat, images and OCR (recommended)
gemma3:4b|Gemma 3 4B|3.4|yes|chat and images, by Google
qwen3:4b-instruct-2507-q4_K_M|Qwen3 4B|2.5|no|text only, quick and capable
llama3.2:3b|Llama 3.2 3B|2.0|no|text only, the smallest and fastest
qwen3:4b|Qwen3 4B Thinking|2.5|no|text only, reasons step by step first (slower)
qwen3-vl:8b-instruct|Qwen3-VL 8B|6.1|yes|chat, images and OCR, smarter and slower'
RECOMMENDED="qwen3-vl:4b-instruct"

die() {
  printf '\nError: %s\n' "$*" >&2
  exit 1
}

step() {
  printf '\n==> %s\n' "$*"
}

# ------------------------------------------------------------------- .env ---

env_get() { # the value of KEY in .env, "" if absent
  sed -n "s/^$1=//p" "$ENV_FILE" | tail -n 1
}

env_set() { # set KEY=VALUE in .env: in place if the line exists, else appended
  awk -v k="$1" -v v="$2" '
    index($0, k "=") == 1 { if (!done) print k "=" v; done = 1; next }
    { print }
    END { if (!done) print k "=" v }
  ' "$ENV_FILE" >"$ENV_FILE.tmp"
  mv "$ENV_FILE.tmp" "$ENV_FILE"
}

# ---------------------------------------------------------------- catalog ---

catalog_field() { # catalog_field <ollama name> <column 2-5>, "" if not in the menu
  printf '%s\n' "$CATALOG" | awk -F'|' -v t="$1" -v c="$2" '$1 == t { print $c }'
}

model_label() { # "Qwen3-VL 4B (qwen3-vl:4b-instruct)", or just the Ollama name
  local name
  name="$(catalog_field "$1" 2)"
  if [ -n "$name" ]; then printf '%s (%s)' "$name" "$1"; else printf '%s' "$1"; fi
}

# ----------------------------------------------------------------- ollama ---

OLLAMA_PORT="11434"
OLLAMA="http://localhost:$OLLAMA_PORT"

ollama_up() {
  curl -fs -m 3 "$OLLAMA/api/version" >/dev/null 2>&1
}

docker_ollama_running() { # our Ollama container, whatever the profile says
  [ -n "$(docker ps -q --filter label=com.docker.compose.project=llmchat \
    --filter label=com.docker.compose.service=ollama)" ]
}

has_model() {
  curl -fs -m 10 "$OLLAMA/api/show" -d "{\"model\":\"$1\"}" >/dev/null 2>&1
}

pull_model() { # download with a progress line; Ollama streams JSON progress
  local size
  size="$(catalog_field "$1" 3)"
  step "Downloading $(model_label "$1")${size:+, $size GB}. Only the first time, so it can take a while..."
  curl -sN "$OLLAMA/api/pull" -d "{\"model\":\"$1\"}" | awk '
    /"error"/ { sub(/.*"error":"/, ""); sub(/".*/, ""); printf "\n    %s\n", $0 > "/dev/stderr"; exit 1 }
    match($0, /"total":[0-9]+/) { total = substr($0, RSTART + 8, RLENGTH - 8) }
    match($0, /"completed":[0-9]+/) {
      got = substr($0, RSTART + 12, RLENGTH - 12)
      # One line per file; the small ones (prompt template, licence) would flash by.
      if (total > 10000000) { printf "\r    %5.1f%%   %.2f of %.2f GB   ", 100 * got / total, got / 1e9, total / 1e9; fflush() }
    }
    /"status":"success"/ { ok = 1 }
    END { printf "\n"; exit(ok ? 0 : 1) }
  ' || die "the download of $1 failed. Check your internet connection and the model name (https://ollama.com/library), then run this again."
}

memory_gb() { # memory the model can use: Docker's limit, or the computer's RAM
  local bytes=""
  if [ "$MODE" = docker ]; then
    bytes="$(docker info --format '{{.MemTotal}}' 2>/dev/null || true)"
  elif [ "$(uname)" = Darwin ]; then
    bytes="$(sysctl -n hw.memsize 2>/dev/null || true)"
  elif [ -r /proc/meminfo ]; then
    bytes="$(awk '/^MemTotal:/ { print $2 * 1024 }' /proc/meminfo)"
  fi
  [ -n "$bytes" ] && awk -v b="$bytes" 'BEGIN { printf "%.1f", b / 1073741824 }'
}

# ------------------------------------------------------------- the menu -----

choose_model() { # prints the chosen Ollama name (or "mock"); the menu goes to stderr
  local mem n=0 tag name size vision good note choice custom
  mem="$(memory_gb || true)"
  {
    printf '\nWhich AI model should the app use?\n'
    printf 'It runs on your computer, so your chats stay private. It downloads once.\n\n'
    while IFS='|' read -r tag name size vision good; do
      n=$((n + 1))
      note=""
      # The model, its working memory, and the rest of the app must fit.
      if [ -n "$mem" ] && awk -v s="$size" -v m="$mem" 'BEGIN { exit !(s * 1.2 + 2 > m) }'; then
        note="  [needs more memory than the ${mem} GB available]"
      fi
      printf '  %d) %-18s %4s GB   %s%s\n' "$n" "$name" "$size" "$good" "$note"
    done <<EOF
$CATALOG
EOF
    printf '  %d) Another model from https://ollama.com/library (you type its name)\n' $((n + 1))
    printf '  %d) No AI: the mock model, for testing the app (no download)\n\n' $((n + 2))
  } >&2

  while :; do
    printf 'Your choice [1]: ' >&2
    read -r choice || choice=""
    choice="${choice:-1}"
    case "$choice" in
      *[!0-9]*) ;;
      *)
        if [ "$choice" -ge 1 ] && [ "$choice" -le "$n" ]; then
          printf '%s\n' "$CATALOG" | sed -n "${choice}p" | cut -d'|' -f1
          return
        elif [ "$choice" -eq $((n + 1)) ]; then
          printf 'Model name, as on ollama.com (e.g. mistral:7b): ' >&2
          read -r custom || custom=""
          case "$custom" in
            "" | *[!A-Za-z0-9._:/-]*) printf 'That is not a model name.\n' >&2 ;;
            *:*) printf '%s\n' "$custom"; return ;;
            *) printf '%s:latest\n' "$custom"; return ;;
          esac
          continue
        elif [ "$choice" -eq $((n + 2)) ]; then
          printf 'mock\n'
          return
        fi
        ;;
    esac
    printf 'Please type a number from 1 to %d.\n' $((n + 2)) >&2
  done
}

# ------------------------------------------------- config/models.local.json --

model_json() { # model_json <ollama name> <base url> <context window> <default?> <sort>
  local name vision good id
  name="$(catalog_field "$1" 2)"
  vision="$(catalog_field "$1" 4)"
  good="$(catalog_field "$1" 5)"
  id="$(printf '%s' "$1" | tr 'A-Z' 'a-z' | tr -c 'a-z0-9-' '-' | tr -s '-' | sed 's/-$//')"
  [ "$vision" = yes ] && vision=true || vision=false
  good="${good% (recommended)}"
  cat <<EOF
  {
    "id": "$id",
    "name": "${name:-$1}",
    "description": "Runs in Ollama on your computer: ${good:-a model you chose from the Ollama library}.",
    "provider": "openai",
    "base_url": "$2",
    "model_id": "$1",
    "vision": $vision,
    "ocr": $vision,
    "context_window": $3,
    "max_output_tokens": 2048,
    "default": $4,
    "sort": $5
  }
EOF
}

write_models_file() { # the chosen model (default) + the other downloaded menu models
  local base_url="$1" ctx="$2" installed tag sort=20
  installed="$(curl -fs -m 10 "$OLLAMA/api/tags")" || die "cannot list the models in Ollama."
  {
    printf '[\n'
    model_json "$LOCAL_MODEL" "$base_url" "$ctx" true 10
    for tag in $(printf '%s\n' "$CATALOG" | cut -d'|' -f1); do
      [ "$tag" = "$LOCAL_MODEL" ] && continue
      case "$installed" in *"\"name\":\"$tag\""*) ;; *) continue ;; esac
      printf ',\n'
      model_json "$tag" "$base_url" "$ctx" false "$sort"
      sort=$((sort + 10))
    done
    printf ']\n'
  } >"config/$MODELS_FILE"
}

# ------------------------------------------------------------- the app ------

wait_for() { # wait_for <url> <what>
  local i
  for i in $(seq 1 120); do
    curl -fs -m 3 "$1" >/dev/null 2>&1 && return 0
    sleep 2
  done
  die "$2 did not start. See why with: docker compose logs"
}

start_app() {
  step "Building and starting the app (the first time takes 5-15 minutes)..."
  docker compose up -d --build
  wait_for "http://localhost:$API_PORT/api/health/" "The API"
  wait_for "http://localhost:$WEB_PORT/healthz" "The website"
  # The api loads the model list when it starts; this reloads it in case the
  # file changed while the container kept running.
  docker compose exec -T api python manage.py sync_models >/dev/null
}

check_model_answers() { # ask the model one question, from inside the api container
  step "Loading the model and checking that it answers (the first time takes a minute)..."
  if ! docker compose exec -T api python - "$1" "$LOCAL_MODEL" <<'PY'; then
import json, sys, urllib.request
base_url, model = sys.argv[1], sys.argv[2]
body = json.dumps({"model": model, "max_tokens": 16,
                   "messages": [{"role": "user", "content": "Say hello in three words."}]}).encode()
request = urllib.request.Request(base_url + "/chat/completions", body, {"Content-Type": "application/json"})
try:
    with urllib.request.urlopen(request, timeout=900) as response:
        answer = json.load(response)["choices"][0]["message"].get("content") or "(it is thinking)"
except Exception as exc:
    sys.exit(f"    {exc}")
print("    The model says:", " ".join(answer.split())[:80])
PY
    die "the app cannot get an answer from the model at $1. See: docker compose logs api$([ "$MODE" = docker ] && printf ' ollama')"
  fi
}

# ------------------------------------------------------------------ main ----

command -v docker >/dev/null 2>&1 || die "Docker is not installed: https://www.docker.com/products/docker-desktop/"
command -v curl >/dev/null 2>&1 || die "curl is not installed."
docker info >/dev/null 2>&1 || die "Docker is not running. Open Docker Desktop, wait until it says 'Engine running', and try again."

[ -f "$ENV_FILE" ] || cp .env.example "$ENV_FILE"
WEB_PORT="$(env_get WEB_PORT)"
WEB_PORT="${WEB_PORT:-3000}"
API_PORT="$(env_get API_PORT)"
API_PORT="${API_PORT:-8000}"
MAILPIT_PORT="$(env_get MAILPIT_PORT)"
MAILPIT_PORT="${MAILPIT_PORT:-8025}"
OLLAMA_PORT="$(env_get OLLAMA_PORT)"
OLLAMA_PORT="${OLLAMA_PORT:-11434}"
OLLAMA="http://localhost:$OLLAMA_PORT"

# Where does Ollama run? Ours in Docker if it is already up; else the Ollama
# app if one answers; else a new Docker container.
PREVIOUS_PROFILES="$(env_get COMPOSE_PROFILES)"
if docker_ollama_running; then
  MODE=docker
elif ollama_up; then
  MODE=native
elif ! $CHOOSE && [ -z "${MODEL:-}" ] && [ -n "$(env_get LOCAL_MODEL)" ] \
  && [ "$(env_get LOCAL_MODEL)" != mock ] && [ "$PREVIOUS_PROFILES" != ollama ]; then
  die "the Ollama app is not running, and the app was set up to use it. Open Ollama and run this again (or 'make model' to run models in Docker instead)."
else
  MODE=docker
fi

LOCAL_MODEL="${MODEL:-$(env_get LOCAL_MODEL)}"
if [ -n "${MODEL:-}" ]; then
  : # chosen on the command line
elif $CHOOSE || [ -z "$LOCAL_MODEL" ]; then
  if [ -t 0 ]; then
    LOCAL_MODEL="$(choose_model)"
  else
    LOCAL_MODEL="$RECOMMENDED"
    printf 'No terminal to ask in: using %s. Choose another with: make model\n' "$(model_label "$LOCAL_MODEL")"
  fi
fi
env_set LOCAL_MODEL "$LOCAL_MODEL"

if [ "$LOCAL_MODEL" = mock ]; then
  env_set COMPOSE_PROFILES ""
  env_set LLM_MODELS_FILE models.mock.json
  if docker_ollama_running; then docker compose --profile ollama stop ollama; fi # frees its memory
  start_app
  MODEL_LINE="the mock model (no AI). Choose a real one with: make model"
else
  if [ "$MODE" = docker ]; then
    env_set COMPOSE_PROFILES ollama
    BASE_URL="http://ollama:11434/v1"
    CONTEXT=8192 # = OLLAMA_CONTEXT_LENGTH in docker-compose.yml
    step "Starting Ollama in Docker..."
    docker compose up -d ollama
    wait_for "$OLLAMA/api/version" "Ollama"
  else
    env_set COMPOSE_PROFILES ""
    BASE_URL="http://host.docker.internal:$OLLAMA_PORT/v1"
    CONTEXT=4096 # the Ollama app's default context length
    step "Using the Ollama app on your computer."
  fi
  has_model "$LOCAL_MODEL" || pull_model "$LOCAL_MODEL"
  write_models_file "$BASE_URL" "$CONTEXT"
  env_set LLM_MODELS_FILE "$MODELS_FILE"
  start_app
  check_model_answers "$BASE_URL"
  if [ "$MODE" = docker ]; then
    MODEL_LINE="$(model_label "$LOCAL_MODEL"), in Ollama in Docker (CPU only)."
  else
    MODEL_LINE="$(model_label "$LOCAL_MODEL"), in the Ollama app on your computer."
  fi
fi

printf '\n  Ready! Open http://localhost:%s and sign up.\n' "$WEB_PORT"
printf '  Emails (your sign-up code):  http://localhost:%s\n' "$MAILPIT_PORT"
printf '  AI model:  %s\n' "$MODEL_LINE"
printf '  Change model: make model    Stop: make down\n'
if [ "$MODE" = docker ] && [ "$LOCAL_MODEL" != mock ] && [ "$(uname)" = Darwin ]; then
  printf '\n  Tip: answers come several times faster with the Ollama app, which uses your\n'
  printf '  Mac'"'"'s GPU. Install it from https://ollama.com/download, run make down, open\n'
  printf '  Ollama, then run make model (it downloads the model again, into the app).\n'
fi
