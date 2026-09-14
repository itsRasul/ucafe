ARG NODE_IMAGE=node:22-alpine

# -------------------------
# Build stage
# -------------------------
FROM ${NODE_IMAGE} AS builder

WORKDIR /ucafe

COPY . .

# RUN npm ci
RUN npm ci --include=optional
RUN node -e "require('sharp'); console.log('Sharp OK:', process.platform, process.arch, require('sharp').versions)"

RUN npm run build --workspace=@ucafe/api


# -------------------------
# Production stage
# -------------------------
FROM ${NODE_IMAGE} AS runner

WORKDIR /ucafe

ENV NODE_ENV=production

COPY --from=builder /ucafe/node_modules ./node_modules
COPY --from=builder /ucafe/apps/api/dist ./apps/api/dist

EXPOSE 3001

CMD ["sh", "-c", "node node_modules/typeorm/cli.js -d apps/api/dist/database/data-source.js migration:run && node apps/api/dist/main.js"]