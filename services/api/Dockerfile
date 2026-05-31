# syntax=docker/dockerfile:1.7

FROM python:3.12-slim AS base

# uv = fast Python package manager (Astral)
COPY --from=ghcr.io/astral-sh/uv:0.5.13 /uv /usr/local/bin/uv

WORKDIR /app

# Install deps in a venv at /app/.venv. uv handles lock + sync.
ENV UV_LINK_MODE=copy \
    UV_COMPILE_BYTECODE=1 \
    UV_PYTHON_DOWNLOADS=never \
    UV_HTTP_TIMEOUT=600

COPY pyproject.toml uv.lock* ./

# Install runtime deps only (no dev group). If the lockfile is stale (e.g.
# new dep added to pyproject.toml), --frozen would silently succeed on the
# old set, so we always re-lock when --locked check disagrees with the file.
RUN --mount=type=cache,target=/root/.cache/uv \
    (uv sync --no-dev --frozen 2>/dev/null) \
    || (uv lock && uv sync --no-dev)

# Belt-and-braces: ensure stripe is in the venv even if the lockfile/sync
# layer got cached against an older pyproject. Cheap if already installed.
RUN --mount=type=cache,target=/root/.cache/uv \
    /app/.venv/bin/python -c "import stripe" 2>/dev/null \
    || uv pip install --python /app/.venv/bin/python "stripe>=11.0.0"

COPY app ./app

ENV PATH="/app/.venv/bin:${PATH}" \
    PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1

EXPOSE 8000

CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000"]
