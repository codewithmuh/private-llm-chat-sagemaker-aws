# Speech to text for the chat's microphone button (backend/apps/speech).
#
# whisper.cpp (https://github.com/ggml-org/whisper.cpp) runs Whisper, OpenAI's
# open-source speech recognition model, on the CPU. Your voice never leaves your
# machine (or your AWS account): browsers' built-in speech recognition sends the
# audio to Google or Apple instead.
#
# whisper.cpp publishes no image for ARM (Apple silicon, AWS Graviton), so this
# builds its server from source and adds the model. docker-compose.yml builds
# it locally; scripts/deploy.sh pushes it to ECR, and it runs next to the api
# in its ECS task.
#
# It listens on port 9000, with an OpenAI-style endpoint:
#   POST /v1/audio/transcriptions   multipart: file=<16 kHz WAV>, response_format=json
#
# WHISPER_MODEL: "base" (142 MB) is quick on a CPU. "small" (466 MB) is more
# accurate, especially in languages other than English. All models:
# https://huggingface.co/ggerganov/whisper.cpp
#   docker build --build-arg WHISPER_MODEL=small speech/

ARG WHISPER_CPP_VERSION=v1.9.4

# ---- 1. build the server
FROM debian:bookworm-slim AS build
ARG WHISPER_CPP_VERSION
RUN apt-get update \
    && apt-get install -y --no-install-recommends build-essential cmake git ca-certificates curl \
    && rm -rf /var/lib/apt/lists/*
RUN git clone --depth 1 --branch "$WHISPER_CPP_VERSION" https://github.com/ggml-org/whisper.cpp /src
WORKDIR /src
# GGML_NATIVE=OFF: a binary for the CPU family, not just the machine that built
# it (CI builds the image; another machine runs it).
RUN cmake -B build -DCMAKE_BUILD_TYPE=Release -DBUILD_SHARED_LIBS=OFF -DGGML_NATIVE=OFF \
        -DWHISPER_BUILD_TESTS=OFF -DWHISPER_SDL2=OFF \
    && cmake --build build --config Release -j "$(nproc)" --target whisper-server

ARG WHISPER_MODEL=base
RUN curl -fsSL -o /model.bin "https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-${WHISPER_MODEL}.bin"

# ---- 2. the image: the server, the model, nothing else
FROM debian:bookworm-slim
RUN apt-get update \
    && apt-get install -y --no-install-recommends libgomp1 curl \
    && rm -rf /var/lib/apt/lists/* \
    && useradd --uid 10001 whisper
COPY --from=build /src/build/bin/whisper-server /usr/local/bin/whisper-server
COPY --from=build /model.bin /models/model.bin

USER whisper
EXPOSE 9000
# CPU threads per transcription.
ENV WHISPER_THREADS=4

HEALTHCHECK --interval=10s --timeout=3s --start-period=10s --retries=5 \
  CMD curl -fsS -o /dev/null http://127.0.0.1:9000/ || exit 1

CMD ["sh", "-c", "exec whisper-server --host 0.0.0.0 --port 9000 --model /models/model.bin --language auto --threads \"$WHISPER_THREADS\" --inference-path /v1/audio/transcriptions"]
