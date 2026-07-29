# Family Tree CMS

A pnpm monorepo containing the CMS frontend, its API, and a placeholder package
for code that may eventually be shared between applications.

## Repository layout

```text
apps/
  web/       React, Vite, and TypeScript CMS frontend
  api/       Express and TypeScript API
packages/
  shared/    Placeholder for future shared types and validation schemas
```

The API is intended to serve both the CMS frontend and a separate client
application. This initial scaffold contains no database integration,
authentication, content models, or CMS business logic.

## Prerequisites

- Node.js 20 or newer
- pnpm 10

If pnpm is not installed, install it with:

```sh
npm install --global pnpm@10
```

## Setup

Install all workspace dependencies:

```sh
pnpm install
```

Create local environment files:

```sh
cp apps/api/.env.example apps/api/.env
cp apps/web/.env.example apps/web/.env
```

## Development

Run the frontend and backend together:

```sh
pnpm dev
```

- CMS frontend: `http://localhost:5173`
- API: `http://localhost:3000`
- API health check: `http://localhost:3000/api/health`

The backend's `CORS_ORIGIN` setting accepts a comma-separated list of allowed
origins. Add the separate client application's origin when it is known.

## Build and production start

Build every workspace package:

```sh
pnpm build
```

After building, start the API and serve the frontend build concurrently:

```sh
pnpm start
```

The frontend preview server uses `http://localhost:4173` by default.

Individual applications can also be run with pnpm filters, for example:

```sh
pnpm --filter @family-tree-cms/api dev
pnpm --filter @family-tree-cms/web build
```

