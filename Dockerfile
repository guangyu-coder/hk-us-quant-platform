# Multi-stage build for Rust application
FROM rust:1.75-slim as builder

# Install system dependencies
RUN apt-get update && apt-get install -y \
    pkg-config \
    libssl-dev \
    libpq-dev \
    curl \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Copy manifests first for better caching
COPY Cargo.toml Cargo.lock ./

# Create a dummy main.rs to build dependencies
RUN mkdir src && echo "fn main() {}" > src/main.rs

# Build dependencies (this will be cached if Cargo.toml doesn't change)
RUN cargo build --release && rm -rf src target/release/deps/hk_us_quant_platform*

# Copy source code
COPY src ./src
COPY migrations ./migrations

# Build the application
RUN cargo build --release

# Runtime stage
FROM debian:bookworm-slim as runtime

# Install runtime dependencies
RUN apt-get update && apt-get install -y \
    ca-certificates \
    libssl3 \
    libpq5 \
    curl \
    && rm -rf /var/lib/apt/lists/*

# Create app user for security
RUN useradd -m -u 1001 -s /bin/bash appuser

WORKDIR /app

# Copy the binary from builder stage
COPY --from=builder /app/target/release/hk-us-quant-platform /app/
COPY --from=builder /app/migrations /app/migrations

# Copy configuration files
COPY .env.example /app/.env
COPY config /app/config

# Create logs directory
RUN mkdir -p /app/logs

# Change ownership to app user
RUN chown -R appuser:appuser /app

USER appuser

# Expose port
EXPOSE 8080

# Health check
HEALTHCHECK --interval=30s --timeout=10s --start-period=5s --retries=3 \
    CMD curl -f http://localhost:8080/health || exit 1

# Run the application
CMD ["./hk-us-quant-platform"]

# Development stage (optional)
FROM builder as development

# Install additional development tools
RUN cargo install cargo-watch sqlx-cli

# Copy source for development
COPY . .

# Expose port for development
EXPOSE 8080

# Development command with hot reload
CMD ["cargo", "watch", "-x", "run"]