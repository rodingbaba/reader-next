# syntax=docker/dockerfile:1.7

FROM node:22-bookworm-slim AS frontend-builder
WORKDIR /app/frontend
COPY frontend/package*.json ./
RUN npm ci
COPY frontend/ ./
RUN npm run build

FROM lukemathwalker/cargo-chef:latest-rust-1-bookworm AS chef
WORKDIR /app

FROM chef AS planner
COPY Cargo.toml Cargo.lock ./
COPY src ./src
RUN cargo chef prepare --recipe-path recipe.json

FROM chef AS backend-builder
WORKDIR /app
RUN apt-get -o Acquire::Retries=3 update \
    && apt-get install -y -o Acquire::Retries=3 --no-install-recommends pkg-config libsqlite3-dev \
    && rm -rf /var/lib/apt/lists/*

# Cache dependencies
COPY --from=planner /app/recipe.json recipe.json
RUN cargo chef cook --release --recipe-path recipe.json

# Copy source code and build
COPY Cargo.toml Cargo.lock ./
COPY src ./src
RUN cargo build --release --locked \
    && cp target/release/reader-next /app/reader-next

FROM debian:bookworm-slim AS runtime
RUN apt-get -o Acquire::Retries=3 update \
    && apt-get install -y -o Acquire::Retries=3 --no-install-recommends ca-certificates curl libsqlite3-0 tzdata gosu \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app
RUN groupadd -g 10001 reader && \
    useradd --system --uid 10001 --gid 10001 --home-dir /app reader
COPY scripts/entrypoint.sh /usr/local/bin/entrypoint.sh
RUN chmod +x /usr/local/bin/entrypoint.sh
COPY --from=backend-builder /app/reader-next /app/reader-next
COPY --from=frontend-builder /app/frontend/dist /app/web/dist
RUN mkdir -p /app/storage/assets

ENV SERVER_HOST=0.0.0.0 \
    SERVER_PORT=18080 \
    DATABASE_URL=sqlite:/app/storage/reader.db?mode=rwc \
    STORAGE_DIR=/app/storage \
    ASSETS_DIR=/app/storage/assets \
    WEB_ROOT=/app/web/dist \
    LOG_LEVEL=info \
    REQUEST_TIMEOUT_SECS=15

EXPOSE 18080
VOLUME ["/app/storage"]
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=5 \
    CMD curl -fsS http://127.0.0.1:18080/ >/dev/null || exit 1
ENTRYPOINT ["/usr/local/bin/entrypoint.sh"]
CMD ["/app/reader-next"]
