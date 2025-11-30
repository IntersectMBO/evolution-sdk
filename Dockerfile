FROM node:20-alpine AS base

# Enable corepack + pnpm (modern way, no npm install -g)
RUN corepack enable && corepack prepare pnpm@latest --activate
ENV PNPM_HOME="/pnpm"
ENV PATH="$PNPM_HOME:$PATH"

# Only needed system packages (very small)
RUN apk add --no-cache git bash curl jq

WORKDIR /app

# Copy only lockfiles & package.jsons first → perfect layer caching
COPY pnpm-lock.yaml pnpm-workspace.yaml turbo.json package.json ./
COPY packages/**/package.json ./packages/

# Install dependencies (cached if lockfile unchanged)
RUN --mount=type=cache,id=pnpm,target=/pnpm/store \
    pnpm install --frozen-lockfile

# Now copy source and build
COPY . .
RUN pnpm turbo build --filter=@evolution-sdk/*

# Development stage
FROM base AS development
ENV NODE_ENV=development
COPY . .
CMD ["pnpm", "turbo", "dev", "--filter=@evolution-sdk/*"]

# Production stage - prune and create minimal image
FROM base AS builder
RUN pnpm prune --prod

# Final tiny runtime image
FROM node:20-alpine AS production
RUN corepack enable && corepack prepare pnpm@latest --activate
ENV PNPM_HOME="/pnpm"
ENV PATH="$PNPM_HOME:$PATH"
ENV NODE_ENV=production

WORKDIR /app

# Copy only what we actually need
COPY --from=builder /app/package.json ./
COPY --from=builder /app/pnpm-lock.yaml ./
COPY --from=builder /app/pnpm-workspace.yaml ./
COPY --from=builder /app/turbo.json ./
COPY --from=builder /app/tsconfig*.json ./
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/packages ./packages

# Default command
CMD ["/bin/sh"]