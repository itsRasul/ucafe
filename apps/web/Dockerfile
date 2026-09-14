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
ENV PORT=3000

EXPOSE 3000

CMD ["npm", "run", "dev", "--workspace=@ucafe/web", "--", "--hostname", "0.0.0.0"]


# -------------------------
# Build
# -------------------------
FROM base AS builder

RUN npm run build --workspace=@ucafe/web


# -------------------------
# Production
# -------------------------
FROM ${NODE_IMAGE} AS production

WORKDIR /ucafe

ENV NODE_ENV=production
ENV PORT=3000

COPY --from=builder /ucafe/apps/web/.next/standalone ./
COPY --from=builder /ucafe/apps/web/.next/static ./apps/web/.next/static
COPY --from=builder /ucafe/apps/web/public ./apps/web/public

EXPOSE 3000

CMD ["node", "apps/web/server.js"]