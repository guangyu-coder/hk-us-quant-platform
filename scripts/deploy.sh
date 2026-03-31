#!/bin/bash

set -euo pipefail

PROJECT_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$PROJECT_ROOT"

COMPOSE_CMD=(docker compose)
APP_PORT="${APP_PORT:-3002}"
PUBLIC_URL="http://localhost:${APP_PORT}"
HEALTH_URL="${PUBLIC_URL}/health"
export DOCKER_BUILDKIT="${DOCKER_BUILDKIT:-1}"
export COMPOSE_DOCKER_CLI_BUILD="${COMPOSE_DOCKER_CLI_BUILD:-1}"

usage() {
    cat <<'EOF'
Usage:
  ./scripts/deploy.sh up [--build] [--observability] [--port <port>] [--service <name>]
  ./scripts/deploy.sh build [service]
  ./scripts/deploy.sh restart [service]
  ./scripts/deploy.sh refresh <service>
  ./scripts/deploy.sh down
  ./scripts/deploy.sh destroy
  ./scripts/deploy.sh status
  ./scripts/deploy.sh logs [service]

Commands:
  up         Start the containerized stack or a specific service.
  build      Build all services or one named service.
  restart    Restart all services or one named service.
  refresh    Rebuild and recreate one service without touching its dependencies.
  down       Stop and remove containers, keep volumes.
  destroy    Stop and remove containers and volumes.
  status     Show compose service status.
  logs       Show compose logs. Optionally limit to one service.

Options:
  --build          Rebuild images before starting.
  --observability  Enable prometheus and grafana profile on startup.
  --port <port>    Bind nginx to the specified host port. Default: 3002.
  --service <name> Target one compose service for the up command.
EOF
}

require_docker() {
    if ! docker info >/dev/null 2>&1; then
        echo "Docker is not running." >&2
        exit 1
    fi
}

ensure_env_file() {
    if [ ! -f .env ]; then
        cp .env.example .env
        echo "Created .env from .env.example"
    fi
}

validate_env_file() {
    local missing=()

    if ! grep -Eq '^DATABASE_URL=.+$' .env; then
        missing+=("DATABASE_URL")
    fi

    if ! grep -Eq '^REDIS_URL=.+$' .env; then
        missing+=("REDIS_URL")
    fi

    if [ "${#missing[@]}" -gt 0 ]; then
        echo "Missing required values in .env: ${missing[*]}" >&2
        echo "Update .env or regenerate it from .env.example before deployment." >&2
        exit 1
    fi
}

ensure_port_available() {
    local port="$1"
    if lsof -iTCP:"$port" -sTCP:LISTEN -n -P >/dev/null 2>&1; then
        echo "Port ${port} is already in use. Pass --port <port> or stop the conflicting process." >&2
        exit 1
    fi
}

wait_for_health() {
    local attempts=60
    local sleep_secs=2

    echo "Waiting for ${HEALTH_URL} ..."
    for ((i=1; i<=attempts; i++)); do
        if curl -fsS "$HEALTH_URL" >/dev/null 2>&1; then
            echo "Stack is healthy at ${PUBLIC_URL}"
            return 0
        fi
        sleep "$sleep_secs"
    done

    echo "Stack did not become healthy in time." >&2
    "${COMPOSE_CMD[@]}" ps >&2 || true
    "${COMPOSE_CMD[@]}" logs --tail=100 >&2 || true
    exit 1
}

cmd="${1:-}"
if [ -z "$cmd" ]; then
    usage
    exit 1
fi
shift || true

require_docker

case "$cmd" in
    up)
        build_flag=""
        profile_args=()
        port_value="$APP_PORT"
        service_name=""

        while [ "$#" -gt 0 ]; do
            case "$1" in
                --build)
                    build_flag="--build"
                    ;;
                --observability)
                    profile_args+=(--profile observability)
                    ;;
                --port)
                    shift
                    if [ "$#" -eq 0 ]; then
                        echo "Missing value for --port" >&2
                        usage
                        exit 1
                    fi
                    port_value="$1"
                    if ! [[ "$port_value" =~ ^[0-9]+$ ]] || [ "$port_value" -lt 1 ] || [ "$port_value" -gt 65535 ]; then
                        echo "Invalid port: $port_value" >&2
                        exit 1
                    fi
                    ;;
                --service)
                    shift
                    if [ "$#" -eq 0 ]; then
                        echo "Missing value for --service" >&2
                        usage
                        exit 1
                    fi
                    service_name="$1"
                    ;;
                *)
                    echo "Unknown option for up: $1" >&2
                    usage
                    exit 1
                    ;;
            esac
            shift
        done

        ensure_env_file
        validate_env_file

        APP_PORT="$port_value"
        export APP_PORT
        PUBLIC_URL="http://localhost:${APP_PORT}"
        HEALTH_URL="${PUBLIC_URL}/health"
        ensure_port_available "$APP_PORT"

        compose_args=(up -d)
        if [ -n "$build_flag" ]; then
            compose_args+=("$build_flag")
        fi
        if [ -n "$service_name" ]; then
            compose_args+=("$service_name")
        fi

        if [ "${#profile_args[@]}" -gt 0 ]; then
            "${COMPOSE_CMD[@]}" "${profile_args[@]}" "${compose_args[@]}"
        else
            "${COMPOSE_CMD[@]}" "${compose_args[@]}"
        fi

        if [ -z "$service_name" ]; then
            wait_for_health
        fi

        "${COMPOSE_CMD[@]}" ps
        ;;
    build)
        if [ "$#" -gt 1 ]; then
            echo "build accepts at most one service name" >&2
            usage
            exit 1
        fi

        if [ "$#" -eq 1 ]; then
            "${COMPOSE_CMD[@]}" build "$1"
        else
            "${COMPOSE_CMD[@]}" build
        fi
        ;;
    restart)
        if [ "$#" -gt 1 ]; then
            echo "restart accepts at most one service name" >&2
            usage
            exit 1
        fi

        if [ "$#" -eq 1 ]; then
            "${COMPOSE_CMD[@]}" restart "$1"
        else
            "${COMPOSE_CMD[@]}" restart
        fi
        ;;
    refresh)
        if [ "$#" -ne 1 ]; then
            echo "refresh requires exactly one service name" >&2
            usage
            exit 1
        fi

        "${COMPOSE_CMD[@]}" up -d --build --no-deps "$1"
        "${COMPOSE_CMD[@]}" ps "$1"
        ;;
    down)
        "${COMPOSE_CMD[@]}" down
        ;;
    destroy)
        "${COMPOSE_CMD[@]}" down -v
        ;;
    status)
        "${COMPOSE_CMD[@]}" ps
        ;;
    logs)
        if [ "$#" -gt 0 ]; then
            "${COMPOSE_CMD[@]}" logs -f "$1"
        else
            "${COMPOSE_CMD[@]}" logs -f
        fi
        ;;
    *)
        echo "Unknown command: $cmd" >&2
        usage
        exit 1
        ;;
esac
