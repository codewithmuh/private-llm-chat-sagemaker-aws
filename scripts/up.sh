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
# Where the model runs (MODEL_ENGINE in .env). All three speak the same
# OpenAI-style API as vLLM on SageMaker, so the app code is the same:
#   docker-model-runner  Docker Model Runner, part of Docker Desktop. Runs the
#                        model on your GPU (Apple silicon, NVIDIA): the fastest.
#                        Off by default in Docker Desktop; this script offers to
#                        turn it on (`docker desktop enable model-runner`).
#   ollama               Ollama (https://ollama.com) in a Docker container.
#                        Works everywhere, but on the CPU only.
#   ollama-app           The Ollama app, if you installed it yourself and it is
#                        running. Optional: nothing here installs it.
#
# The choices are kept in .env: MODEL_ENGINE, LOCAL_MODEL, LLM_MODELS_FILE and
# COMPOSE_PROFILES ("ollama" makes `docker compose up` start Ollama too).
#
# Works with the bash 3.2 that ships with macOS, and in Git Bash on Windows.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

ENV_FILE=".env"
MODELS_FILE="models.local.json" # in config/, which the api container reads
CONTEXT=8192                    # tokens; = OLLAMA_CONTEXT_LENGTH in docker-compose.yml
CHOOSE=false
[ "${1:-}" = "--choose" ] && CHOOSE=true

# The menu. One model per line, with its name in each engine, and the sampling
# settings its authors recommend (from each model card; presence_penalty keeps
# small models from repeating themselves):
#   Ollama name | Docker Model Runner name | name in the app | download GB | images? | good for
#   | temperature | other settings (JSON)
CATALOG='qwen3-vl:4b-instruct|ai/qwen3-vl:4B-UD-Q4_K_XL|Qwen3-VL 4B|3.3|yes|chat, images and OCR|0.7|{"top_p": 0.8, "top_k": 20, "presence_penalty": 1.5}
gemma3:4b|ai/gemma3:4B-Q4_K_M|Gemma 3 4B|3.4|yes|chat and images, by Google|1.0|{"top_p": 0.95, "top_k": 64}
qwen3:4b-instruct-2507-q4_K_M|ai/qwen3:4b-instruct-2507|Qwen3 4B|2.5|no|text only, quick and capable|0.7|{"top_p": 0.8, "top_k": 20, "presence_penalty": 1.0}
llama3.2:3b|ai/llama3.2:3B-Q4_K_M|Llama 3.2 3B|2.0|no|text only, the smallest and fastest|0.6|{"top_p": 0.9}
qwen3:4b|ai/qwen3:4b-thinking-2507|Qwen3 4B Thinking|2.5|no|text only, reasons step by step first (slower)|0.6|{"top_p": 0.95, "top_k": 20}
qwen3-vl:8b-instruct|ai/qwen3-vl:8B|Qwen3-VL 8B|6.2|yes|chat, images and OCR, smarter|0.7|{"top_p": 0.8, "top_k": 20, "presence_penalty": 1.5}'

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

name_column() { # the catalog column with model names for this engine
  if [ "$ENGINE" = docker-model-runner ]; then echo 2; else echo 1; fi
}

catalog_field() { # catalog_field <model name, either engine> <column 3-8>
  printf '%s\n' "$CATALOG" | awk -F'|' -v t="$1" -v c="$2" '$1 == t || $2 == t { print $c }'
}

engine_name() { # the same menu model, named for this engine (unchanged if unknown)
  local col found
  col="$(name_column)"
  found="$(printf '%s\n' "$CATALOG" | awk -F'|' -v t="$1" -v c="$col" '$1 == t || $2 == t { print $c }')"
  printf '%s' "${found:-$1}"
}

model_label() { # "Qwen3-VL 4B (qwen3-vl:4b-instruct)", or just the name
  local name
  name="$(catalog_field "$1" 3)"
  if [ -n "$name" ]; then printf '%s (%s)' "$name" "$1"; else printf '%s' "$1"; fi
}

memory_gb() { # memory the model can use, in GB
  local bytes="" docker_vm=0
  if [ "$ENGINE" = ollama ]; then
    # In a container: Docker Desktop's limit (Settings > Resources > Memory).
    bytes="$(docker info --format '{{.MemTotal}}' 2>/dev/null || true)"
  else
    # Next to Docker: the computer's RAM, minus what Docker Desktop's virtual
    # machine keeps for itself (on Linux, Docker runs without one).
    if [ "$(uname)" = Darwin ]; then
      bytes="$(sysctl -n hw.memsize 2>/dev/null || true)"
    elif [ -r /proc/meminfo ]; then
      bytes="$(awk '/^MemTotal:/ { print $2 * 1024 }' /proc/meminfo)"
    fi
    case "$(docker info --format '{{.OperatingSystem}}' 2>/dev/null)" in
      *"Docker Desktop"*) docker_vm="$(docker info --format '{{.MemTotal}}' 2>/dev/null || echo 0)" ;;
    esac
  fi
  [ -n "$bytes" ] && awk -v b="$bytes" -v d="$docker_vm" 'BEGIN { printf "%.1f", (b - d) / 1073741824 }'
}

fits() { # fits <download GB> <memory GB>: the model, its working memory and the app
  awk -v s="$1" -v m="$2" 'BEGIN { exit !(s * 1.2 + 2 <= m) }'
}

recommended() { # the 8B vision model on a GPU with room for it, else the 4B one
  local mem
  mem="$(memory_gb || true)"
  if [ "$ENGINE" != ollama ] && [ -n "$mem" ] && fits 6.2 "$mem"; then
    engine_name qwen3-vl:8b-instruct
  else
    engine_name qwen3-vl:4b-instruct
  fi
}

# ---------------------------------------------------------------- engines ---

OLLAMA_PORT="11434"
OLLAMA="http://localhost:$OLLAMA_PORT"

ollama_up() {
  curl -fs -m 3 "$OLLAMA/api/version" >/dev/null 2>&1
}

docker_ollama_running() { # our Ollama container, whatever the profile says
  [ -n "$(docker ps -q --filter label=com.docker.compose.project=llmchat \
    --filter label=com.docker.compose.service=ollama)" ]
}

model_runner_on() {
  # Not `| grep -q`: with pipefail, grep quitting early can fail the pipe.
  case "$(docker model status 2>/dev/null)" in *"is running"*) return 0 ;; *) return 1 ;; esac
}

model_runner_worth_it() { # Docker Desktop, and a GPU it can use
  docker desktop enable model-runner --help >/dev/null 2>&1 || return 1
  { [ "$(uname -s)" = Darwin ] && [ "$(uname -m)" = arm64 ]; } || command -v nvidia-smi >/dev/null 2>&1
}

offer_model_runner() { # ask to turn Docker Model Runner on; true if it is on
  local answer i
  [ -t 0 ] || return 1
  printf '\nDocker Model Runner (part of Docker Desktop) runs AI models on your GPU:\n' >&2
  printf 'answers come several times faster than from a container. It is switched off.\n' >&2
  printf 'Turn it on? This runs: docker desktop enable model-runner  [Y/n] ' >&2
  read -r answer || answer=n
  case "$answer" in [nN]*) return 1 ;; esac
  docker desktop enable model-runner >/dev/null || return 1
  for i in $(seq 1 30); do
    model_runner_on && return 0
    sleep 2
  done
  return 1
}

choose_engine() {
  if model_runner_on; then
    ENGINE=docker-model-runner
  elif model_runner_worth_it && offer_model_runner; then
    ENGINE=docker-model-runner
  elif ! docker_ollama_running && ollama_up; then
    ENGINE=ollama-app
  else
    ENGINE=ollama
  fi
}

has_model() {
  if [ "$ENGINE" = docker-model-runner ]; then
    docker model inspect "$1" >/dev/null 2>&1
  else
    curl -fs -m 10 "$OLLAMA/api/show" -d "{\"model\":\"$1\"}" >/dev/null 2>&1
  fi
}

installed_models() { # text that contains the name of every downloaded model
  if [ "$ENGINE" = docker-model-runner ]; then
    docker model ls --json
  else
    curl -fs -m 10 "$OLLAMA/api/tags"
  fi
}

pull_model() {
  local size
  size="$(catalog_field "$1" 4)"
  step "Downloading $(model_label "$1")${size:+, about $size GB}. Only the first time, so it can take a while..."
  if [ "$ENGINE" = docker-model-runner ]; then
    docker model pull "$1" || die "the download of $1 failed. Check your internet connection and the model name, then run this again."
    return
  fi
  # Ollama streams its progress as JSON lines.
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

# ------------------------------------------------------------- the menu -----

choose_model() { # prints the chosen model name (or "mock"); the menu goes to stderr
  local mem col best n=0 default=1 line tag name size vision good note choice custom where
  mem="$(memory_gb || true)"
  col="$(name_column)"
  best="$(recommended)"
  {
    printf '\nWhich AI model should the app use?\n'
    printf 'It runs on your computer, so your chats stay private. It downloads once.\n\n'
    while IFS= read -r line; do
      n=$((n + 1))
      tag="$(printf '%s' "$line" | cut -d'|' -f"$col")"
      IFS='|' read -r _ _ name size vision good _ <<EOF
$line
EOF
      note=""
      if [ "$tag" = "$best" ]; then
        good="$good (recommended)"
        default=$n
      fi
      if [ -n "$mem" ] && ! fits "$size" "$mem"; then
        note="  [needs more memory than the ${mem} GB available]"
      fi
      printf '  %d) %-18s %4s GB   %s%s\n' "$n" "$name" "$size" "$good" "$note"
    done <<EOF
$CATALOG
EOF
    if [ "$ENGINE" = docker-model-runner ]; then
      where="https://hub.docker.com/u/ai (or hf.co/...)"
    else
      where="https://ollama.com/library"
    fi
    printf '  %d) Another model from %s (you type its name)\n' $((n + 1)) "$where"
    printf '  %d) No AI: the mock model, for testing the app (no download)\n\n' $((n + 2))
  } >&2

  while :; do
    printf 'Your choice [%d]: ' "$default" >&2
    read -r choice || choice=""
    choice="${choice:-$default}"
    case "$choice" in
      *[!0-9]*) ;;
      *)
        if [ "$choice" -ge 1 ] && [ "$choice" -le "$n" ]; then
          printf '%s\n' "$CATALOG" | sed -n "${choice}p" | cut -d'|' -f"$col"
          return
        elif [ "$choice" -eq $((n + 1)) ]; then
          printf 'Model name (e.g. %s): ' "$([ "$col" = 2 ] && echo ai/mistral || echo mistral:7b)" >&2
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

model_json() { # model_json <model name> <base url> <default?> <sort>
  local name vision good temperature params id where
  name="$(catalog_field "$1" 3)"
  vision="$(catalog_field "$1" 5)"
  good="$(catalog_field "$1" 6)"
  temperature="$(catalog_field "$1" 7)"
  params="$(catalog_field "$1" 8)"
  [ -n "$temperature" ] || temperature=0.7 # a model you typed in yourself
  [ -n "$params" ] || params='{}'
  id="$(printf '%s' "${1#ai/}" | tr 'A-Z' 'a-z' | tr -c 'a-z0-9-' '-' | tr -s '-' | sed 's/-$//')"
  [ "$vision" = yes ] && vision=true || vision=false
  case "$ENGINE" in
    docker-model-runner) where="Docker Model Runner, on your GPU" ;;
    ollama-app) where="the Ollama app on your computer" ;;
    *) where="Ollama in Docker" ;;
  esac
  cat <<EOF
  {
    "id": "$id",
    "name": "${name:-$1}",
    "description": "Runs in $where: ${good:-a model you chose}.",
    "provider": "openai",
    "base_url": "$2",
    "model_id": "$1",
    "vision": $vision,
    "ocr": $vision,
    "context_window": $CONTEXT,
    "max_output_tokens": 2048,
    "temperature": $temperature,
    "params": $params,
    "default": $3,
    "sort": $4
  }
EOF
}

write_models_file() { # the chosen model (default) + the other downloaded menu models
  local base_url="$1" installed tag sort=20
  installed="$(installed_models)" || die "cannot list the downloaded models."
  {
    printf '[\n'
    model_json "$LOCAL_MODEL" "$base_url" true 10
    for tag in $(printf '%s\n' "$CATALOG" | cut -d'|' -f"$(name_column)"); do
      [ "$tag" = "$LOCAL_MODEL" ] && continue
      # Ollama lists "llama3.2:3b"; Docker Model Runner "docker.io/ai/gemma3:4B-Q4_K_M".
      case "$installed" in *"\"$tag\""* | *"/$tag\""*) ;; *) continue ;; esac
      printf ',\n'
      model_json "$tag" "$base_url" false "$sort"
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
    die "the app cannot get an answer from the model at $1. See: docker compose logs api$([ "$ENGINE" = ollama ] && printf ' ollama')"
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

# 1. Where the model runs. Chosen once (or again with `make model`).
ENGINE="$(env_get MODEL_ENGINE)"
if [ -z "$ENGINE" ] && [ -n "$(env_get LOCAL_MODEL)" ] && [ "$(env_get LOCAL_MODEL)" != mock ]; then
  # Set up before MODEL_ENGINE existed: Ollama, in Docker or the app.
  if [ "$(env_get COMPOSE_PROFILES)" = ollama ]; then ENGINE=ollama; else ENGINE=ollama-app; fi
fi
if $CHOOSE || [ -z "$ENGINE" ]; then
  choose_engine
fi
case "$ENGINE" in
  docker-model-runner)
    model_runner_on || die "Docker Model Runner is switched off. Turn it on with: docker desktop enable model-runner (or Docker Desktop > Settings > AI), or run 'make model' to choose again."
    ;;
  ollama-app)
    ollama_up || die "the app is set up for the Ollama app, and it is not running. Open Ollama and try again, or run 'make model' to choose again."
    ;;
  ollama) ;;
  *) die "MODEL_ENGINE=$ENGINE in .env is not one of: docker-model-runner, ollama, ollama-app." ;;
esac
env_set MODEL_ENGINE "$ENGINE"

# 2. Which model.
LOCAL_MODEL="${MODEL:-$(env_get LOCAL_MODEL)}"
if [ -n "${MODEL:-}" ]; then
  : # chosen on the command line
elif $CHOOSE || [ -z "$LOCAL_MODEL" ]; then
  if [ -t 0 ]; then
    LOCAL_MODEL="$(choose_model)"
  else
    LOCAL_MODEL="$(recommended)"
    printf 'No terminal to ask in: using %s. Choose another with: make model\n' "$(model_label "$LOCAL_MODEL")"
  fi
fi
[ "$LOCAL_MODEL" = mock ] || LOCAL_MODEL="$(engine_name "$LOCAL_MODEL")"
env_set LOCAL_MODEL "$LOCAL_MODEL"

# 3. Download it, describe it to the app, start everything, check it answers.
if [ "$ENGINE" != ollama ] || [ "$LOCAL_MODEL" = mock ]; then
  env_set COMPOSE_PROFILES ""
  if docker_ollama_running; then docker compose --profile ollama stop ollama; fi # frees its memory
fi

if [ "$LOCAL_MODEL" = mock ]; then
  env_set LLM_MODELS_FILE models.mock.json
  start_app
  MODEL_LINE="the mock model (no AI). Choose a real one with: make model"
else
  case "$ENGINE" in
    docker-model-runner)
      BASE_URL="http://model-runner.docker.internal/engines/v1"
      step "Using Docker Model Runner (your GPU)."
      ;;
    ollama-app)
      BASE_URL="http://host.docker.internal:$OLLAMA_PORT/v1"
      CONTEXT=4096 # the Ollama app's default context length
      step "Using the Ollama app on your computer."
      ;;
    ollama)
      env_set COMPOSE_PROFILES ollama
      BASE_URL="http://ollama:11434/v1"
      step "Starting Ollama in Docker..."
      docker compose up -d ollama
      wait_for "$OLLAMA/api/version" "Ollama"
      ;;
  esac
  has_model "$LOCAL_MODEL" || pull_model "$LOCAL_MODEL"
  if [ "$ENGINE" = docker-model-runner ]; then
    # How much the model reads at once, and keep it loaded between messages.
    docker model configure --context-size "$CONTEXT" --keep-alive 30m "$LOCAL_MODEL" >/dev/null
  fi
  write_models_file "$BASE_URL"
  env_set LLM_MODELS_FILE "$MODELS_FILE"
  start_app
  check_model_answers "$BASE_URL"
  case "$ENGINE" in
    docker-model-runner) MODEL_LINE="$(model_label "$LOCAL_MODEL"), in Docker Model Runner (GPU)." ;;
    ollama-app) MODEL_LINE="$(model_label "$LOCAL_MODEL"), in the Ollama app on your computer." ;;
    *) MODEL_LINE="$(model_label "$LOCAL_MODEL"), in Ollama in Docker (CPU only)." ;;
  esac
fi

printf '\n  Ready! Open http://localhost:%s and sign up.\n' "$WEB_PORT"
printf '  Emails (your sign-up code):  http://localhost:%s\n' "$MAILPIT_PORT"
printf '  AI model:  %s\n' "$MODEL_LINE"
printf '  Change model: make model    Stop: make down\n'
if [ "$ENGINE" = ollama ] && [ "$LOCAL_MODEL" != mock ] && model_runner_worth_it; then
  printf '\n  Tip: Docker Model Runner (part of Docker Desktop) runs the model on your GPU,\n'
  printf '  several times faster. Run make model and answer yes when it asks.\n'
fi
