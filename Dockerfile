# Shared base image for all Rust build stages
FROM rust:1.89-slim-bookworm AS chef

RUN apt-get update && apt-get install -y \
    pkg-config \
    libssl-dev \
    libpq-dev \
    curl \
    python3 \
    && rm -rf /var/lib/apt/lists/*

RUN cargo install cargo-chef --locked

WORKDIR /app

# Build dependency graph once so dependency compilation can be cached
FROM chef AS planner

COPY Cargo.toml Cargo.lock ./
COPY src ./src
COPY data ./data
COPY migrations ./migrations
COPY scripts ./scripts

RUN cargo chef prepare --recipe-path recipe.json

# Compile dependencies using the generated recipe
FROM chef AS builder

COPY --from=planner /app/recipe.json recipe.json

RUN cargo chef cook --release --recipe-path recipe.json

COPY Cargo.toml Cargo.lock ./
COPY src ./src
COPY data ./data
COPY migrations ./migrations
COPY scripts ./scripts

RUN cargo build --release && \
    cp /app/target/release/hk-us-quant-platform /app/hk-us-quant-platform

# Runtime stage
FROM debian:trixie-slim AS runtime

RUN apt-get update && apt-get install -y \
    ca-certificates \
    libssl3 \
    libpq5 \
    curl \
    python3 \
    python3-pip \
    && pip3 install --no-cache-dir --break-system-packages \
        sqlalchemy \
        psycopg2-binary \
        requests \
        yfinance \
        pandas \
    && rm -rf /var/lib/apt/lists/*

RUN useradd -m -u 1001 -s /bin/bash appuser

WORKDIR /app

COPY --from=builder /app/hk-us-quant-platform /app/
COPY --from=builder /app/data /app/data
COPY --from=builder /app/migrations /app/migrations
COPY --from=builder /app/scripts /app/scripts

COPY .env.example /app/.env
COPY config /app/config

RUN mkdir -p /app/logs && chown -R appuser:appuser /app

USER appuser

EXPOSE 8080

HEALTHCHECK --interval=30s --timeout=10s --start-period=5s --retries=3 \
    CMD curl -f http://localhost:8080/health || exit 1

CMD ["./hk-us-quant-platform"]

# Development stage (optional)
FROM chef AS development

RUN cargo install cargo-watch sqlx-cli

COPY . .

EXPOSE 8080

CMD ["cargo", "watch", "-x", "run"]
