#!/bin/bash
# Docker build and deployment helper script

set -e

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

echo_info() { echo -e "${GREEN}[INFO]${NC} $1"; }
echo_warn() { echo -e "${YELLOW}[WARN]${NC} $1"; }
echo_error() { echo -e "${RED}[ERROR]${NC} $1"; }

# Check if Docker is running
if ! docker info > /dev/null 2>&1; then
    echo_error "Docker is not running. Please start Docker and try again."
    exit 1
fi

# Function to build development image
build_dev() {
    echo_info "Building development image..."
    DOCKER_BUILDKIT=1 docker build \
        --target development \
        --tag evolution-sdk:dev \
        --tag evolution-sdk:latest \
        -f Dockerfile \
        .
    echo_info "Development image built successfully!"
}

# Function to build production image
build_prod() {
    echo_info "Building production image..."
    DOCKER_BUILDKIT=1 docker build \
        --target production \
        --tag evolution-sdk:prod \
        --tag evolution-sdk:$(node -p "require('./package.json').version") \
        .
    echo_info "Production image built successfully!"
}

# Function to build docs image
build_docs() {
    echo_info "Building documentation image..."
    # Copy dockerignore temporarily
    cp .dockerignore .dockerignore.bak 2>/dev/null || true
    cp .dockerignore.docs .dockerignore
    
    DOCKER_BUILDKIT=1 docker build \
        --target development \
        --file Dockerfile.docs \
        --tag evolution-sdk-docs:dev \
        --tag evolution-sdk-docs:latest \
        .
    
    # Restore original dockerignore
    mv .dockerignore.bak .dockerignore 2>/dev/null || true
    
    echo_info "Documentation image built successfully!"
}

# Function to run tests in Docker
run_tests() {
    echo_info "Running tests in Docker..."
    docker run --rm evolution-sdk:dev pnpm turbo test --filter=@evolution-sdk/*
    echo_info "Tests completed successfully!"
}

# Function to start development environment
start_dev() {
    echo_info "Starting development environment..."
    docker-compose up -d evolution-dev
    echo_info "Development environment is running!"
    echo_info "View logs: docker-compose logs -f evolution-dev"
}

# Function to start documentation site
start_docs() {
    echo_info "Starting documentation site..."
    docker-compose up -d evolution-docs
    echo_info "Documentation site is running at http://localhost:3000"
}

# Function to clean up Docker resources
cleanup() {
    echo_warn "Cleaning up Docker resources..."
    docker-compose down -v
    docker system prune -f
    echo_info "Cleanup completed!"
}

# Function to show usage
usage() {
    cat << EOF
Usage: $0 [command]

Commands:
    dev           Build development image
    prod          Build production image
    docs          Build documentation image
    test          Run tests in Docker
    start-dev     Start development environment with docker-compose
    start-docs    Start documentation site
    cleanup       Clean up Docker resources
    all           Build all images
    help          Show this help message

Examples:
    $0 dev              # Build development image
    $0 start-dev        # Start development environment
    $0 test             # Run tests
    $0 cleanup          # Clean up Docker resources

EOF
}

# Main script logic
case "${1:-}" in
    dev)
        build_dev
        ;;
    prod)
        build_prod
        ;;
    docs)
        build_docs
        ;;
    test)
        run_tests
        ;;
    start-dev)
        start_dev
        ;;
    start-docs)
        start_docs
        ;;
    cleanup)
        cleanup
        ;;
    all)
        build_dev
        build_prod
        echo_warn "Skipping docs build (requires additional dependencies)"
        echo_info "Core images built successfully!"
        ;;
    help|--help|-h)
        usage
        ;;
    *)
        echo_error "Unknown command: ${1:-}"
        usage
        exit 1
        ;;
esac

exit 0
