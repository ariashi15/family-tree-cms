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

The API serves both the authenticated CMS frontend and a separate public
client. CMS routes validate Supabase sessions and approved admin access before
using the backend's privileged database client.

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
SUPABASE_ADMIN_USERS_TABLE=admin_users
```

Use the Supabase secret key on the API only. Do not place it in the frontend
`.env` file.

Add the browser-safe Supabase credentials to `apps/web/.env`:

```sh
VITE_API_URL=http://localhost:3000
VITE_SUPABASE_URL=https://your-project-id.supabase.co
VITE_SUPABASE_ANON_KEY=your-publishable-key
```

Apply the checked-in Supabase security migration before using authentication:

```text
supabase/migrations/20260816000000_secure_admin_users.sql
```

You can paste that file into the Supabase SQL Editor and run it. It normalizes
admin emails, enforces unique emails and linked user IDs, and removes direct
browser access to `admin_users`. Admin access and admin management then go
through the authenticated API.

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
- `GET /api/public/members` publicly returns rows for the separate client application
- `POST /api/auth/claim-access` securely links an approved email to its authenticated user ID
- `GET /api/members` returns rows to an approved CMS admin
- `POST /api/members`, `PATCH /api/members/:id`, and `DELETE /api/members/:id`
  modify member rows for an approved CMS admin
- `POST /api/pairings/import` creates missing big and little rows for an approved CMS admin
- `GET`, `POST`, and `PATCH /api/admin-users` manage approved users for a super admin

All routes except `/api/health` and `/api/public/members` require a valid
Supabase access token in the `Authorization: Bearer <token>` header. The API
also verifies that the token's user ID belongs to an active `admin_users` row.

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
