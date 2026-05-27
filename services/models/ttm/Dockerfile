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

# The HF cache lives on a docker volume so weights download once, not per
# rebuild. Granite-TSFM also keeps PyTorch tensors here.
RUN mkdir -p /cache/hf && chmod -R 777 /cache

COPY pyproject.toml uv.lock* ./

RUN --mount=type=cache,target=/root/.cache/uv \
    uv sync --no-dev --frozen 2>/dev/null || uv sync --no-dev

COPY app ./app

ENV PATH="/app/.venv/bin:${PATH}"

EXPOSE 8081

CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8081"]
