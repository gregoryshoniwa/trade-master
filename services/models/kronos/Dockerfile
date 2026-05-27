# syntax=docker/dockerfile:1.7

FROM python:3.12-slim AS base

COPY --from=ghcr.io/astral-sh/uv:0.5.13 /uv /usr/local/bin/uv

WORKDIR /app

ENV UV_LINK_MODE=copy \
    UV_COMPILE_BYTECODE=1 \
    UV_PYTHON_DOWNLOADS=never \
    HF_HOME=/cache/hf \
    HUGGINGFACE_HUB_CACHE=/cache/hf \
    PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1

# HF cache lives on a docker volume so weights download once, not per rebuild.
RUN mkdir -p /cache/hf && chmod -R 777 /cache

# Vendor the Kronos model package at a PINNED commit (it's not on PyPI). The
# `model/` dir exports Kronos/KronosTokenizer/KronosPredictor and resolves via
# `from model import ...` because /app is the working dir (on sys.path).
RUN apt-get update && apt-get install -y --no-install-recommends git \
 && rm -rf /var/lib/apt/lists/*
ARG KRONOS_SHA=67b630e67f6a18c9e9be918d9b4337c960db1e9a
RUN git clone https://github.com/shiyu-coder/Kronos.git /tmp/kronos \
 && git -C /tmp/kronos checkout ${KRONOS_SHA} \
 && cp -r /tmp/kronos/model /app/model \
 && rm -rf /tmp/kronos

COPY pyproject.toml uv.lock* ./

RUN --mount=type=cache,target=/root/.cache/uv \
    uv sync --no-dev --frozen 2>/dev/null || uv sync --no-dev

COPY app ./app

ENV PATH="/app/.venv/bin:${PATH}"

EXPOSE 8082

CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8082"]
