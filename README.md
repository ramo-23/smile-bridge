# Smile Bridge

Monorepo scaffold for a dental clinic management system. The API and web app run on the host; Docker Compose is used only for PostgreSQL.

## Prerequisites

- Node.js 22 or later and npm
- Docker Desktop with Docker Compose

## Setup

1. Install dependencies from the repository root with `npm install`.
2. Copy `.env.example` to `.env` and adjust local values if needed. PostgreSQL is published on host port `5433` by default (`POSTGRES_PORT`/`DB_PORT`). The API also accepts `apps/api/.env`; the web app accepts `apps/web/.env`.
3. Start PostgreSQL with `npm run db:up`.

## Run

- `npm run dev:api` starts the NestJS API at `http://localhost:3000`; `GET /health` reports API status.
- `npm run dev:web` starts the Vite app at `http://localhost:5173`.
- `npm run db:down` stops the database container without deleting its named volume.
- `npm run migration:run` runs TypeORM SQL migrations.
- `npm run migration:generate -- src/database/migrations/MigrationName` generates a migration from entity changes.
- `npm test` runs API Jest and web Vitest.
- `npm run lint` and `npm run format` run the shared ESLint and Prettier configuration.

## Folder overview

- `apps/api`: NestJS modules, shared API infrastructure, environment validation, and TypeORM migrations.
- `apps/web`: React/Vite app, routes, feature placeholders, reusable component location, and design tokens.
- `docker-compose.yml`: PostgreSQL 16 with a persistent named volume and healthcheck.
- Root configuration: npm workspaces, strict shared TypeScript settings, ESLint, Prettier, and Husky.
