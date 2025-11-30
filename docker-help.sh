#!/bin/bash
# Quick Docker commands reference for Evolution SDK

cat << 'EOF'
╔════════════════════════════════════════════════════════════════╗
║            Evolution SDK - Docker Quick Reference              ║
╚════════════════════════════════════════════════════════════════╝

🚀 QUICK START
──────────────────────────────────────────────────────────────────
  ./docker-build.sh dev         Build development image
  ./docker-build.sh start-dev   Start development environment
  docker-compose up -d          Start all services

🔨 BUILD COMMANDS
──────────────────────────────────────────────────────────────────
  ./docker-build.sh dev         Development image
  ./docker-build.sh prod        Production image
  ./docker-build.sh docs        Documentation image
  ./docker-build.sh test        Run tests
  ./docker-build.sh all         Build everything

▶️  RUN COMMANDS
──────────────────────────────────────────────────────────────────
  docker run -it evolution-sdk:dev           Interactive shell
  docker run evolution-sdk:test              Run tests
  docker-compose up evolution-dev            Start dev server
  docker-compose up evolution-docs           Start docs site

📊 MANAGEMENT
──────────────────────────────────────────────────────────────────
  docker ps                     List running containers
  docker images                 List images
  docker logs <container>       View logs
  docker-compose logs -f        Follow all logs
  docker exec -it <id> bash     Shell into container

🧹 CLEANUP
──────────────────────────────────────────────────────────────────
  ./docker-build.sh cleanup     Full cleanup
  docker-compose down           Stop services
  docker-compose down -v        Stop + remove volumes
  docker system prune -f        Clean unused resources

🔍 DEBUGGING
──────────────────────────────────────────────────────────────────
  docker logs <container>           View container logs
  docker inspect <container>        Container details
  docker exec -it <id> sh          Get shell access
  docker-compose ps                 Service status
  docker build --progress=plain     Verbose build output

📦 COMMON WORKFLOWS
──────────────────────────────────────────────────────────────────
Development:
  1. ./docker-build.sh dev
  2. docker-compose up -d evolution-dev
  3. docker-compose logs -f evolution-dev

Testing:
  1. ./docker-build.sh test
  2. docker run evolution-sdk:test

Production:
  1. ./docker-build.sh prod
  2. docker run evolution-sdk:prod

Documentation:
  1. ./docker-build.sh docs
  2. ./docker-build.sh start-docs
  3. Open http://localhost:3000

🌐 PORTS
──────────────────────────────────────────────────────────────────
  3000    Documentation site
  3001    Cardano DevNet node

📚 DOCUMENTATION
──────────────────────────────────────────────────────────────────
  DOCKER.md           Full Docker guide
  PROJECT-AUDIT.md    Complete project audit
  README.md           Project overview

🆘 TROUBLESHOOTING
──────────────────────────────────────────────────────────────────
BuildKit error:
  export DOCKER_BUILDKIT=1

Large build context:
  Check .dockerignore file

Permission denied:
  sudo usermod -aG docker $USER

Container exits:
  docker logs <container>
  Check CMD in Dockerfile

╚════════════════════════════════════════════════════════════════╝
EOF
