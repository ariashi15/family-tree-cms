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

## Member row addition and update rules

This section describes the behavior currently implemented by `POST /api/members`
and `PATCH /api/members/:id`. The frontend shows confirmation dialogs for
cascades, but the API repeats the important validation so callers cannot bypass
the rules by sending requests directly.

### Rules shared by additions and updates

- `member_name` is required. Leading and trailing whitespace is removed.
- `member_big` is optional. A missing, empty, or `null` value is stored as
  `null`.
- `dynasty` is required and is normalized to lowercase. Its value must be
  `fire`, `water`, `earth`, or `wind`.
- `is_dynasty_head` is required and must be a boolean.
- A member has at most one big because `member_big` is a single value. Any
  number of members may name the same big.
- A member may not name themself as their big. The normal self-reference check
  ignores letter casing.
- Member names are treated as case-insensitively unique by the application.
  For example, `Alice Wong` and `alice wong` are intended to be the same name.
- Relationship links use the text in `member_name` and `member_big`; they are
  not foreign keys to member IDs. Consequently, unique and consistently cased
  names are necessary for reliable graph traversal and cascades.

### Adding a row

The add flow performs these operations:

1. Validate all four submitted fields.
2. Reject the request with `409 Conflict` if the submitted member name already
   exists.
3. If a big was provided, determine whether that name already exists as a
   member. Matching ignores letter casing.
4. If the big does not exist and `create_missing_big` is false, return `409
   Conflict` with `requiresbigConfirmation: true`. The CMS uses this response
   to show the additional row in its confirmation dialog.
5. After confirmation, insert the missing big first with `member_big = null`
   and the same submitted dynasty as the new member.
6. Insert the requested member with the submitted big and dynasty-head value.
   If the big already exists, use the big's dynasty; otherwise, use the
   submitted dynasty.

An existing big is reused; no duplicate big row is intentionally created. A
new member under an existing big always inherits that big's dynasty. If the big
is missing, the big instead inherits the new member's submitted dynasty because
the new member is the only known source of family dynasty information in that
case. A newly created missing big is not a dynasty head, while the requested
member receives the submitted `is_dynasty_head` value.

Adding a row does not inspect descendants or other connected relatives because
the member being created cannot already have relationships pointing away from
it. Self-reference is still rejected.

### Updating a row

Updates target the row by `id`, even when `member_name` changes. The request
acts as a replacement of the editable state rather than a conventional sparse
patch. `member_name`, `dynasty`, and `is_dynasty_head` must be present;
an omitted `member_big` is interpreted as `null`.

The update flow applies the following rules:

- **Renaming:** Changing `member_name` to another existing member's name is
  rejected with `409 Conflict`. After a successful rename, every row whose
  `member_big` exactly equals the old name is updated to the new name.
- **Clearing a big:** Setting `member_big` to `null` removes the relationship.
  No replacement row is created, and no dynasty inheritance is triggered solely
  by clearing the field.
- **Changing to an existing big:** Assigning an existing big causes the edited
  member and all of their descendants to inherit that big's dynasty. Ancestors
  and siblings from the member's former branch are not changed solely because
  the member was reparented.
- **Changing to a missing big:** The API first returns the missing-big
  confirmation response. Once confirmed, it creates the big with
  `member_big = null`, the edited member's submitted dynasty, and the database
  default for dynasty-head status. The new big therefore inherits the little's
  dynasty rather than the other way around.
- **Cycle prevention:** A proposed big is rejected if it is the member themself
  or one of the member's descendants. This prevents a member from becoming
  their own ancestor and prevents longer cycles in the family tree.
- **Changing dynasty:** A direct dynasty change propagates through the entire
  connected family component after applying the proposed name and big. The
  traversal treats big/little links as bidirectional, so it reaches ancestors,
  descendants, siblings, and more distant relatives connected through them.
- **Changing dynasty-head status:** `is_dynasty_head` changes only on the
  edited row. The application does not enforce exactly one dynasty head per
  dynasty and does not automatically clear the flag from another member.

### Simultaneous changes and precedence

An update may change several fields at once. Relationship inheritance takes
precedence over a conflicting submitted dynasty:

1. Create a confirmed missing big, if necessary.
2. If the big changed to an existing member, replace the edited member's
   submitted dynasty with that big's dynasty.
3. Update the target row with the resulting fields.
4. Cascade a changed member name into direct littles' `member_big` fields.
5. If the big changed to an existing member, apply that big's dynasty to the
   edited member and all descendants. The big, their ancestors, and their
   other branches are left unchanged.
6. Otherwise, if the requested dynasty differs from the original dynasty,
   apply it to the entire connected family component.

Therefore, changing both fields cannot recolor the existing big's family with
the conflicting submitted value. The frontend also selects and locks the
inherited dynasty as soon as an existing big is chosen, while the API enforces
the same precedence for direct callers.

Changing a big to a newly created member has no competing existing dynasty, so
the new big and edited branch use the submitted dynasty.

### Edge cases and current limitations

- **Rename plus relationship change:** The old and new member names are treated
  as aliases during validation. Setting the big to the member's old name is
  rejected as a self-reference, and descendant-cycle detection models the
  pending rename before allowing the update.
- **No transaction across cascades:** Missing-big creation, the main row
  update, rename cascades, and dynasty cascades are separate database
  operations. If a later operation fails, earlier operations are not rolled
  back. For example, a newly created big can remain after the requested member
  update fails, or only part of a dynasty tree can be updated.
- **Concurrent requests:** Duplicate checks and inserts are separate
  operations, and updates do not use version numbers or row locks. Concurrent
  requests can race, and the last successful update wins. Database-level unique
  constraints and transactional server-side functions would be needed for
  complete protection.
- **Text-based graph ambiguity:** Duplicate names, inconsistent casing, or a
  `member_big` value that does not match a current `member_name` make that edge
  invisible to family traversal. The API attempts to prevent or repair these
  states during normal CMS operations but cannot guarantee correctness for rows
  written outside the API.

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

After building, start the production server:

```sh
pnpm start
```

The Express process serves both the API and the compiled frontend from one
origin. `vite preview` is available as `pnpm --filter @family-tree-cms/web
preview` for local build inspection only; it is not the production server.

### Production environment and hosting

Deploy the repository to a Node.js host that runs these commands:

```sh
pnpm install --frozen-lockfile
pnpm build
pnpm start
```

Set these server-side environment variables in the host's secret manager:

```sh
NODE_ENV=production
SUPABASE_URL=https://your-project-id.supabase.co
SUPABASE_SECRET_KEY=your-secret-key
SUPABASE_MEMBERS_TABLE=members
SUPABASE_ADMIN_USERS_TABLE=admin_users
CORS_ORIGIN=https://cms.example.com
```

`CORS_ORIGIN` is fail-closed in production and accepts only exact HTTPS
origins. Use a comma-separated list only if another browser client must call
the API directly, for example
`https://cms.example.com,https://client.example.com`. Do not use `*`, paths,
or trailing slashes. Requests without an `Origin` header, such as server-side
requests, remain supported.

The host must terminate HTTPS and redirect HTTP traffic to HTTPS. Replace
`https://cms.example.com` with the final deployed domain. In Supabase, open
**Authentication → URL Configuration** and set:

- **Site URL:** `https://cms.example.com`
- **Redirect URLs:** add the exact value `https://cms.example.com`

The magic-link code redirects to `window.location.origin`, so the configured
Supabase value and deployed origin must match exactly.

The frontend build needs the browser-safe values below. They are compiled into
the JavaScript bundle and must not contain the Supabase secret key:

```sh
VITE_SUPABASE_URL=https://your-project-id.supabase.co
VITE_SUPABASE_ANON_KEY=your-publishable-key
```

`VITE_API_URL` is optional in production because the compiled frontend calls
the same origin by default. Set it only when intentionally deploying the API at
a different exact HTTPS origin. Never expose `SUPABASE_SECRET_KEY` as a `VITE_`
variable or commit real `.env` files.

### Verification

Run the local checks before deployment:

```sh
pnpm test
pnpm build
pnpm audit --prod
```

After deployment, verify `/api/health`, request a magic link using the final
domain, confirm that an approved admin can enter the CMS, and confirm that an
unapproved Supabase user is denied access.

Individual applications can also be run with pnpm filters, for example:

```sh
pnpm --filter @family-tree-cms/api dev
pnpm --filter @family-tree-cms/web build
```
