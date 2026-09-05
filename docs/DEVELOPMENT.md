# Local development

## Prerequisites

- Node.js 22 or newer
- Docker Desktop with the Linux container engine running

## First run

1. Copy `.env.example` to `.env`.
2. Start infrastructure with `docker compose up -d`.
3. Install packages with `npm install`.
4. Apply migrations with `npm run migration:run --workspace=@ucafe/api`.
5. Start the API with `npm run dev:api`.
6. Start the web app with `npm run dev:web`.

## Database commands

- Show migrations: `npm run migration:show --workspace=@ucafe/api`
- Apply migrations: `npm run migration:run --workspace=@ucafe/api`
- Revert the latest migration: `npm run migration:revert --workspace=@ucafe/api`

TypeORM synchronization is intentionally disabled. Every schema change must use a reviewed migration.
