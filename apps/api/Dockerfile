ARG NODE_IMAGE=node:22-bookworm-slim

# -------------------------
# Base
# -------------------------
FROM ${NODE_IMAGE} AS base

WORKDIR /ucafe

COPY . .

RUN npm ci --include=optional

# -------------------------
# Development
# -------------------------
FROM base AS development

ENV NODE_ENV=development
ENV API_PORT=3001

EXPOSE 3001

CMD ["npm", "run", "start:dev", "--workspace=@ucafe/api"]


# -------------------------
# Build
# -------------------------
FROM base AS builder

RUN npm run build --workspace=@ucafe/api


# -------------------------
# Production
# -------------------------
FROM ${NODE_IMAGE} AS production

WORKDIR /ucafe

ENV NODE_ENV=production
ENV API_PORT=3001

COPY --from=builder /ucafe/node_modules ./node_modules
COPY --from=builder /ucafe/apps/api/node_modules ./apps/api/node_modules
COPY --from=builder /ucafe/apps/api/dist ./apps/api/dist

EXPOSE 3001

CMD ["sh", "-c", "node node_modules/typeorm/cli.js -d apps/api/dist/database/data-source.js migration:run && node apps/api/dist/main.js"]