-- Row Level Security: a company sees its own rows and nothing else.
--
-- Applied after every migration run (src/db/migrate.ts), so it is safe to run
-- again. Every query on a tenant table runs inside withTenant(), which does
--   SET LOCAL ROLE app_tenant;
--   SELECT set_config('app.org_id', '<company uuid>', true);
-- and the policies below compare each row with that setting. Without the
-- setting nothing matches: a query that forgot its company sees nothing.

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'app_tenant') THEN
    CREATE ROLE app_tenant NOLOGIN;
  END IF;
END
$$;

GRANT USAGE ON SCHEMA public TO app_tenant;

-- The company id of the current transaction, or NULL when none was set.
CREATE OR REPLACE FUNCTION app_org_id() RETURNS uuid
LANGUAGE sql STABLE AS $$
  SELECT NULLIF(current_setting('app.org_id', true), '')::uuid
$$;

-- counters: running numbers per company.
ALTER TABLE counters ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON counters;
CREATE POLICY tenant_isolation ON counters
  USING (organization_id = app_org_id())
  WITH CHECK (organization_id = app_org_id());
GRANT SELECT, INSERT, UPDATE ON counters TO app_tenant;

-- clients
ALTER TABLE clients ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON clients;
CREATE POLICY tenant_isolation ON clients
  USING (organization_id = app_org_id())
  WITH CHECK (organization_id = app_org_id());
GRANT SELECT, INSERT, UPDATE, DELETE ON clients TO app_tenant;

-- audit_log: written and read, never changed.
ALTER TABLE audit_log ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON audit_log;
CREATE POLICY tenant_isolation ON audit_log
  USING (organization_id = app_org_id())
  WITH CHECK (organization_id = app_org_id());
GRANT SELECT, INSERT ON audit_log TO app_tenant;
