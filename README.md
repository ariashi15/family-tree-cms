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

Add your Supabase project credentials to `apps/api/.env`:

```sh
SUPABASE_URL=https://your-project-id.supabase.co
SUPABASE_SECRET_KEY=your-secret-key
SUPABASE_MEMBERS_TABLE=members
```

Use the Supabase secret key on the API only. Do not place it in the frontend
`.env` file.

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

## API endpoints

The backend currently exposes these endpoints:

- `GET /api/health` returns API status and whether Supabase is configured
- `GET /api/members` returns rows from the members table
- `POST /api/pairings/import` creates missing big and little rows

`POST /api/pairings/import` expects this JSON body:

```json
{
  "pairings": [
    {
      "big_name": "Maya Thompson",
      "little_name": "Jordan Lee",
      "dynasty": "fire"
    }
  ]
}
```

Import behavior:

- If a big already exists as `member_name`, that person is skipped and
  reported back to the CMS.
- If a little already exists as `member_name`, that person is skipped and
  reported back to the CMS.
- If a big is missing, a row is created with `member_big` set to `null`.
- If a little is missing, a row is created with `member_big` set to the
  pairing's big name.
- A pairing can partially succeed. For example, an existing big can be
  skipped while a new little from the same row is still inserted.

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
