# Docker Setup for Evolution SDK

Complete Docker configuration for development, testing, and production deployment of Evolution SDK.

## 📋 Table of Contents

- [Quick Start](#quick-start)
- [Available Docker Images](#available-docker-images)
- [Building Images](#building-images)
- [Running Containers](#running-containers)
- [Docker Compose](#docker-compose)
- [CI/CD Integration](#cicd-integration)
- [Troubleshooting](#troubleshooting)

---

## 🚀 Quick Start

### Prerequisites

- Docker Engine 20.10+
- Docker Compose v2+
- BuildKit enabled (recommended)

**Enable BuildKit:**
```bash
export DOCKER_BUILDKIT=1
# Or add to ~/.bashrc:
echo 'export DOCKER_BUILDKIT=1' >> ~/.bashrc
```

### Quick Build & Run

```bash
# Build development image
./docker-build.sh dev

# Start development environment
./docker-build.sh start-dev

# Run tests
./docker-build.sh test

# Build all images
./docker-build.sh all
```

---

## 🐳 Available Docker Images

### 1. Development Image (`evolution-sdk:dev`)
- Full development environment with hot reload
- All source code and dependencies
- TypeScript watch mode enabled
- **Use for:** Local development, debugging

### 2. Production Image (`evolution-sdk:prod`)
- Optimized for deployment
- Only production dependencies
- Pre-built TypeScript output
- Minimal size (~200MB)
- **Use for:** Production deployment, SDK distribution

### 3. Test Image (`evolution-sdk:test`)
- Testing environment
- Coverage reporting enabled
- **Use for:** CI/CD testing

### 4. Documentation Image (`evolution-sdk-docs:latest`)
- Next.js documentation site
- Optimized for serving docs
- **Use for:** Hosting documentation

---

## 🔨 Building Images

### Using Build Script (Recommended)

```bash
# Development
./docker-build.sh dev

# Production
./docker-build.sh prod

# Documentation
./docker-build.sh docs

# All images
./docker-build.sh all
```

### Manual Build Commands

**Development:**
```bash
DOCKER_BUILDKIT=1 docker build \
  --target development \
  --tag evolution-sdk:dev \
  .
```

**Production:**
```bash
DOCKER_BUILDKIT=1 docker build \
  --target production \
  --tag evolution-sdk:prod \
  .
```

**Documentation:**
```bash
DOCKER_BUILDKIT=1 docker build \
  --file Dockerfile.docs \
  --tag evolution-sdk-docs:latest \
  .
```

**Tests:**
```bash
DOCKER_BUILDKIT=1 docker build \
  --target test \
  --tag evolution-sdk:test \
  .
```

---

## ▶️ Running Containers

### Development Environment

**Interactive shell:**
```bash
docker run -it --rm \
  -v $(pwd)/packages:/app/packages \
  -v $(pwd)/docs:/app/docs \
  evolution-sdk:dev \
  /bin/bash
```

**With hot reload:**
```bash
docker run -it --rm \
  -v $(pwd)/packages:/app/packages \
  -p 3000:3000 \
  evolution-sdk:dev
```

### Production Container

```bash
docker run -it --rm evolution-sdk:prod /bin/bash
```

### Run Tests

```bash
docker run --rm evolution-sdk:test
```

### Documentation Site

```bash
docker run -d \
  -p 3000:3000 \
  --name evolution-docs \
  evolution-sdk-docs:latest
```

Access at: http://localhost:3000

---

## 🎼 Docker Compose

### Start All Services

```bash
docker-compose up -d
```

### Individual Services

```bash
# Development environment
docker-compose up -d evolution-dev

# Documentation site
docker-compose up -d evolution-docs

# Run tests
docker-compose up evolution-test
```

### View Logs

```bash
# All services
docker-compose logs -f

# Specific service
docker-compose logs -f evolution-dev
```

### Stop Services

```bash
docker-compose down

# With volume cleanup
docker-compose down -v
```

---

## 📦 Available Services

### `evolution-dev`
- Development environment with hot reload
- Volumes mounted for live code updates
- Port 3000 exposed for docs

### `evolution-docs`
- Production documentation site
- Pre-built Next.js application
- Port 3000 exposed

### `evolution-test`
- Runs test suite
- Generates coverage reports
- Exits after completion

### `cardano-devnet`
- Local Cardano blockchain node
- Port 3001 exposed
- Persistent data volume

---

## 🔧 Advanced Usage

### Custom Package Filters

Run specific packages:
```bash
docker run -it --rm evolution-sdk:dev \
  pnpm turbo dev --filter=@evolution-sdk/evolution
```

### Build with Cache

```bash
DOCKER_BUILDKIT=1 docker build \
  --cache-from evolution-sdk:latest \
  --tag evolution-sdk:dev \
  .
```

### Multi-platform Builds

```bash
docker buildx build \
  --platform linux/amd64,linux/arm64 \
  --tag evolution-sdk:latest \
  .
```

### Execute Commands in Running Container

```bash
# Get container ID
docker ps

# Execute command
docker exec -it <container-id> pnpm turbo build

# Or with compose
docker-compose exec evolution-dev pnpm turbo build
```

---

## 🎯 CI/CD Integration

### GitHub Actions Example

```yaml
name: Docker Build & Test

on: [push, pull_request]

jobs:
  docker-test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      
      - name: Set up Docker Buildx
        uses: docker/setup-buildx-action@v3
      
      - name: Build test image
        run: |
          docker build \
            --target test \
            --tag evolution-sdk:test \
            .
      
      - name: Run tests
        run: docker run --rm evolution-sdk:test
      
      - name: Build production image
        run: |
          docker build \
            --target production \
            --tag evolution-sdk:prod \
            .
```

### GitLab CI Example

```yaml
docker-build:
  image: docker:latest
  services:
    - docker:dind
  script:
    - docker build --target production -t evolution-sdk:prod .
    - docker build --target test -t evolution-sdk:test .
    - docker run --rm evolution-sdk:test
```

---

## 🔍 Troubleshooting

### BuildKit Not Available

**Error:** `BuildKit is enabled but the buildx component is missing`

**Solution:**
```bash
# Arch Linux
sudo pacman -S docker-buildx

# Ubuntu/Debian
sudo apt install docker-buildx-plugin

# macOS
brew install docker-buildx
```

### Context Size Too Large

**Error:** `Sending build context to Docker daemon  1.5GB`

**Solution:**
- Verify `.dockerignore` file exists
- Check for large `node_modules` in context:
```bash
du -sh * | sort -h
```

### Permission Denied

**Error:** `permission denied while trying to connect to the Docker daemon`

**Solution:**
```bash
# Add user to docker group
sudo usermod -aG docker $USER

# Re-login or:
newgrp docker
```

### Cache Mount Issues

**Error:** `the --mount option requires BuildKit`

**Solution:**
```bash
# Enable BuildKit
export DOCKER_BUILDKIT=1

# Or use legacy builder without cache
docker build --no-cache -t evolution-sdk:dev .
```

### Container Exits Immediately

**Issue:** Container exits in dev mode

**Solution:**
```bash
# Keep container running
docker run -it --rm evolution-sdk:dev /bin/bash

# Or use compose with proper command
docker-compose up evolution-dev
```

---

## 📊 Image Size Optimization

Current image sizes:
- **Development:** ~800MB (includes dev dependencies)
- **Production:** ~200MB (optimized, production only)
- **Documentation:** ~250MB (Next.js + dependencies)

**Optimization tips:**
1. Use `.dockerignore` to exclude unnecessary files
2. Multi-stage builds to separate build and runtime
3. `pnpm prune --prod` to remove dev dependencies
4. Alpine base images for smaller footprint

---

## 🛠️ Customization

### Environment Variables

```bash
docker run -e NODE_ENV=production \
  -e CARDANO_NETWORK=mainnet \
  evolution-sdk:prod
```

### Custom Build Args

```bash
docker build \
  --build-arg NODE_VERSION=20 \
  --build-arg PNPM_VERSION=9.0.0 \
  -t evolution-sdk:custom \
  .
```

### Volume Mounts for Development

```bash
docker run -it --rm \
  -v $(pwd)/packages/evolution:/app/packages/evolution \
  -v evolution-node-modules:/app/node_modules \
  evolution-sdk:dev
```

---

## 📚 Additional Resources

- [Docker Best Practices](https://docs.docker.com/develop/dev-best-practices/)
- [BuildKit Documentation](https://docs.docker.com/build/buildkit/)
- [Multi-stage Builds](https://docs.docker.com/build/building/multi-stage/)
- [Docker Compose](https://docs.docker.com/compose/)

---

## 🆘 Getting Help

If you encounter issues:

1. Check logs: `docker logs <container-id>`
2. Inspect container: `docker inspect <container-id>`
3. Verify build context: `docker build --progress=plain .`
4. Check BuildKit status: `docker buildx version`
5. Open an issue on GitHub with error details

---

## 📝 Quick Reference

```bash
# Build
./docker-build.sh dev|prod|docs|test|all

# Run
docker run -it evolution-sdk:dev
docker-compose up -d

# Manage
docker ps                     # List containers
docker images                 # List images
docker system prune -f        # Clean up
docker-compose logs -f        # View logs

# Cleanup
./docker-build.sh cleanup
```
