# syntax=docker/dockerfile:1.10
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

ARG NEXT_PUBLIC_SENTRY_DSN
ARG NEXT_PUBLIC_SENTRY_ENVIRONMENT
ARG NEXT_PUBLIC_SENTRY_RELEASE
ENV NEXT_PUBLIC_SENTRY_DSN=${NEXT_PUBLIC_SENTRY_DSN}
ENV NEXT_PUBLIC_SENTRY_ENVIRONMENT=${NEXT_PUBLIC_SENTRY_ENVIRONMENT}
ENV NEXT_PUBLIC_SENTRY_RELEASE=${NEXT_PUBLIC_SENTRY_RELEASE}

RUN --mount=type=secret,id=sentry_auth_token,env=SENTRY_AUTH_TOKEN,required=false npm run build --workspace=@ucafe/web


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
