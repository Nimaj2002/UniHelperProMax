# syntax=docker/dockerfile:1
#
# UniHelperProMax: one small image that serves the API and the built frontend.
#
#   docker compose up -d --build        (see docker-compose.yml)
#
# Stages: build the frontend with Node, build the backend's virtualenv with uv, then copy only
# the results onto a trimmed Python-on-Alpine filesystem squashed into a single layer.

ARG PYTHON_VERSION=3.12
ARG NODE_VERSION=22
ARG PNPM_VERSION=10

# ---------- 1. Frontend: static files in /src/dist ----------
FROM node:${NODE_VERSION}-alpine AS frontend
ARG PNPM_VERSION
WORKDIR /src
RUN corepack enable && corepack prepare pnpm@${PNPM_VERSION} --activate
COPY frontend/package.json frontend/pnpm-lock.yaml frontend/.npmrc ./
RUN --mount=type=cache,id=pnpm-store,target=/root/.local/share/pnpm/store \
    pnpm install --frozen-lockfile
COPY frontend/ ./
RUN pnpm build

# ---------- 2. Backend: virtualenv in /opt/venv ----------
FROM python:${PYTHON_VERSION}-alpine AS backend
COPY --from=ghcr.io/astral-sh/uv:latest /uv /bin/uv
ENV UV_PROJECT_ENVIRONMENT=/opt/venv \
    UV_PYTHON_DOWNLOADS=never \
    UV_LINK_MODE=copy \
    UV_COMPILE_BYTECODE=0
# uvicorn[standard] extras the server never uses in production: auto-reload (watchfiles),
# websockets, .env loading and YAML log configs.
ARG SKIP="--no-install-package watchfiles --no-install-package websockets --no-install-package python-dotenv --no-install-package pyyaml"
RUN apk add --no-cache binutils
WORKDIR /src
COPY backend/pyproject.toml backend/uv.lock ./
RUN --mount=type=cache,target=/root/.cache/uv \
    uv sync --frozen --no-dev --no-install-project $SKIP
COPY backend/src ./src
RUN --mount=type=cache,target=/root/.cache/uv \
    uv sync --frozen --no-dev --no-editable $SKIP \
 && find /opt/venv -depth \( -name '__pycache__' -o -name '*.pyc' -o -name 'tests' -o -name 'test' \) \
      -prune -exec rm -rf {} + \
 && find /opt/venv -name '*.so*' -type f -exec strip --strip-unneeded {} +

# ---------- 3. Runtime filesystem: Python minus what a server never needs ----------
FROM python:${PYTHON_VERSION}-alpine AS rootfs
ARG PYTHON_VERSION
RUN set -eux; \
    lib=/usr/local/lib/python${PYTHON_VERSION}; \
    rm -rf "$lib"/ensurepip "$lib"/idlelib "$lib"/tkinter "$lib"/turtledemo "$lib"/test \
           "$lib"/lib2to3 "$lib"/pydoc_data "$lib"/config-*-linux-musl \
           "$lib"/site-packages/pip* "$lib"/site-packages/setuptools* "$lib"/site-packages/wheel* \
           /usr/local/bin/pip* /usr/local/bin/idle* /usr/local/bin/pydoc* \
           /usr/local/include /usr/local/share /var/cache/apk/* /root/.cache; \
    find /usr/local/lib -depth -name '__pycache__' -prune -exec rm -rf {} +; \
    adduser -D -H -u 1000 -s /sbin/nologin unihelper; \
    mkdir -p /data /app; \
    chown unihelper:unihelper /data
COPY --from=backend /opt/venv /opt/venv
COPY --from=frontend /src/dist /app/static

# ---------- 4. Final image: one layer ----------
FROM scratch
COPY --from=rootfs / /
ENV PATH=/opt/venv/bin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin \
    LANG=C.UTF-8 \
    PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    UNIHELPER_DATA_DIR=/data \
    UNIHELPER_STATIC_DIR=/app/static
USER unihelper
WORKDIR /data
VOLUME ["/data"]
EXPOSE 8000
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
    CMD ["python", "-c", "import urllib.request,sys; sys.exit(urllib.request.urlopen('http://127.0.0.1:8000/api/v1/health', timeout=4).status != 200)"]
# One process only (no --workers): note saves and transcript appends are serialized inside the
# server. Behind a reverse proxy, set FORWARDED_ALLOW_IPS to the proxy's address.
CMD ["uvicorn", "unihelper.main:app", "--host", "0.0.0.0", "--port", "8000"]
