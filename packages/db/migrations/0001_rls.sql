-- Row Level Security for every tenant-scoped table.
--
-- The policies read `app.tenant_id`, set per transaction by the application
-- (`select set_config('app.tenant_id', $1, true)`). If the setting is missing
-- the comparison yields NULL and nothing is visible: deny by default.
--
-- `force row level security` makes the policies apply to the table owner too,
-- which matters on Neon where the app connects as the database owner (a
-- non-superuser). Superusers still bypass RLS, so the local PGlite test uses a
-- dedicated non-superuser role to prove the policies are real.

create or replace function app_current_tenant() returns uuid
language sql
stable
as $$
  select nullif(current_setting('app.tenant_id', true), '')::uuid
$$;

do $$
declare
  tbl text;
  tenant_tables text[] := array[
    'memberships',
    'documents',
    'extractions',
    'extraction_fields',
    'invoices',
    'invoice_lines',
    'payments',
    'payment_allocations',
    'discrepancies',
    'proposals',
    'approvals',
    'action_ledger',
    'agent_runs'
  ];
begin
  foreach tbl in array tenant_tables
  loop
    execute format('alter table %I enable row level security', tbl);
    execute format('alter table %I force row level security', tbl);
    execute format('drop policy if exists tenant_isolation on %I', tbl);
    execute format(
      'create policy tenant_isolation on %I using (tenant_id = app_current_tenant()) with check (tenant_id = app_current_tenant())',
      tbl
    );
  end loop;
end
$$;

-- The tenants table is keyed by its own id.
alter table tenants enable row level security;
alter table tenants force row level security;
drop policy if exists tenant_isolation on tenants;
create policy tenant_isolation on tenants
  using (id = app_current_tenant())
  with check (id = app_current_tenant());

-- Full-text search over document text. Deliberately not pg_trgm: PGlite does
-- not ship that extension, and we want local/production parity.
create index if not exists documents_search_idx
  on documents using gin (to_tsvector('simple', search_text));

-- Least-privilege application role. Best effort: managed providers may not let
-- the migration create roles, in which case the owner + FORCE RLS still holds.
do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'ledgerpilot_app') then
    execute 'create role ledgerpilot_app nologin';
  end if;
exception when insufficient_privilege then
  raise notice 'skipping ledgerpilot_app creation (insufficient privilege)';
end
$$;

do $$
begin
  if exists (select 1 from pg_roles where rolname = 'ledgerpilot_app') then
    execute 'grant usage on schema public to ledgerpilot_app';
    execute 'grant select, insert, update, delete on all tables in schema public to ledgerpilot_app';
    execute 'grant usage, select on all sequences in schema public to ledgerpilot_app';
  end if;
exception when others then
  raise notice 'skipping ledgerpilot_app grants: %', sqlerrm;
end
$$;
