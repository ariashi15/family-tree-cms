begin;

alter table public.admin_users enable row level security;

-- Admin emails are canonicalized so application code can use exact equality
-- without relying on ILIKE wildcard behavior.
update public.admin_users
set email = lower(btrim(email));

create unique index if not exists admin_users_normalized_email_key
  on public.admin_users ((lower(btrim(email))));

create unique index if not exists admin_users_user_id_key
  on public.admin_users (user_id)
  where user_id is not null;

-- The browser no longer reads or writes this table directly. All access goes
-- through the authenticated Express API, whose secret-key client retains the
-- service_role privileges needed for these operations.
revoke all privileges on table public.admin_users from anon, authenticated;

commit;
