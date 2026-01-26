#!/bin/bash

# HK-US Quantitative Trading Platform Deployment Script

set -e

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Configuration
ENVIRONMENT=${1:-production}
COMPOSE_FILE="docker-compose.yml"
PROJECT_NAME="hk-us-quant-platform"

echo -e "${GREEN}🚀 Deploying HK-US Quantitative Trading Platform${NC}"
echo -e "${YELLOW}Environment: ${ENVIRONMENT}${NC}"

# Function to print status
print_status() {
    echo -e "${GREEN}✓${NC} $1"
}

print_error() {
    echo -e "${RED}✗${NC} $1"
}

print_warning() {
    echo -e "${YELLOW}⚠${NC} $1"
}

# Check if Docker is running
if ! docker info > /dev/null 2>&1; then
    print_error "Docker is not running. Please start Docker and try again."
    exit 1
fi

print_status "Docker is running"

# Check if Docker Compose is available
if ! command -v docker-compose > /dev/null 2>&1; then
    print_error "Docker Compose is not installed. Please install Docker Compose and try again."
    exit 1
fi

print_status "Docker Compose is available"

# Set compose file based on environment
if [ "$ENVIRONMENT" = "development" ]; then
    COMPOSE_FILE="docker-compose.dev.yml"
    print_status "Using development configuration"
elif [ "$ENVIRONMENT" = "production" ]; then
    COMPOSE_FILE="docker-compose.yml"
    print_status "Using production configuration"
else
    print_error "Invalid environment: $ENVIRONMENT. Use 'development' or 'production'."
    exit 1
fi

# Create necessary directories
mkdir -p logs config/ssl

# Check if .env file exists
if [ ! -f .env ]; then
    print_warning ".env file not found. Creating from .env.example"
    cp .env.example .env
    print_warning "Please review and update the .env file with your configuration"
fi

# Build and start services
echo -e "${YELLOW}Building and starting services...${NC}"

# Pull latest images
docker-compose -f $COMPOSE_FILE -p $PROJECT_NAME pull

# Build application image
docker-compose -f $COMPOSE_FILE -p $PROJECT_NAME build

# Start infrastructure services first
print_status "Starting infrastructure services..."
docker-compose -f $COMPOSE_FILE -p $PROJECT_NAME up -d postgres redis

# Wait for database to be ready
echo -e "${YELLOW}Waiting for database to be ready...${NC}"
timeout=60
counter=0
while ! docker-compose -f $COMPOSE_FILE -p $PROJECT_NAME exec -T postgres pg_isready -U postgres -d quant_platform > /dev/null 2>&1; do
    if [ $counter -ge $timeout ]; then
        print_error "Database failed to start within $timeout seconds"
        exit 1
    fi
    sleep 1
    counter=$((counter + 1))
done

print_status "Database is ready"

# Wait for Redis to be ready
echo -e "${YELLOW}Waiting for Redis to be ready...${NC}"
timeout=30
counter=0
while ! docker-compose -f $COMPOSE_FILE -p $PROJECT_NAME exec -T redis redis-cli ping > /dev/null 2>&1; do
    if [ $counter -ge $timeout ]; then
        print_error "Redis failed to start within $timeout seconds"
        exit 1
    fi
    sleep 1
    counter=$((counter + 1))
done

print_status "Redis is ready"

# Run database migrations (if needed)
if [ "$ENVIRONMENT" = "production" ]; then
    print_status "Running database migrations..."
    # Add migration command here when sqlx-cli is available
    # docker-compose -f $COMPOSE_FILE -p $PROJECT_NAME exec app sqlx migrate run
fi

# Start application services
print_status "Starting application services..."
docker-compose -f $COMPOSE_FILE -p $PROJECT_NAME up -d

# Wait for application to be ready
echo -e "${YELLOW}Waiting for application to be ready...${NC}"
timeout=120
counter=0
while ! curl -f http://localhost:8080/health > /dev/null 2>&1; do
    if [ $counter -ge $timeout ]; then
        print_error "Application failed to start within $timeout seconds"
        docker-compose -f $COMPOSE_FILE -p $PROJECT_NAME logs app
        exit 1
    fi
    sleep 2
    counter=$((counter + 2))
done

print_status "Application is ready"

# Show running services
echo -e "${GREEN}🎉 Deployment completed successfully!${NC}"
echo -e "${YELLOW}Running services:${NC}"
docker-compose -f $COMPOSE_FILE -p $PROJECT_NAME ps

echo -e "${YELLOW}Application URLs:${NC}"
echo -e "  • Health Check: http://localhost:8080/health"
echo -e "  • API Base: http://localhost:8080/api/v1"
if [ "$ENVIRONMENT" = "production" ]; then
    echo -e "  • Prometheus: http://localhost:9090"
    echo -e "  • Grafana: http://localhost:3000 (admin/admin)"
fi

echo -e "${GREEN}✓ Deployment completed successfully!${NC}"