ARG NODE_IMAGE=node:22-alpine

# -------------------------
# Build stage
# -------------------------
FROM ${NODE_IMAGE} AS builder

WORKDIR /ucafe

COPY . .

RUN npm ci

RUN npm run build --workspace=@ucafe/web


# -------------------------
# Production stage
# -------------------------
FROM ${NODE_IMAGE} AS runner

WORKDIR /ucafe

ENV NODE_ENV=production
ENV PORT=3000

COPY --from=builder /ucafe/apps/web/.next/standalone ./
COPY --from=builder /ucafe/apps/web/.next/static ./apps/web/.next/static
COPY --from=builder /ucafe/apps/web/public ./apps/web/public

EXPOSE 3000

CMD ["node", "apps/web/server.js"]