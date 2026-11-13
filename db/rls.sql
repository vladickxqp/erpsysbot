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

-- Products, orders and their lines.

ALTER TABLE products ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON products;
CREATE POLICY tenant_isolation ON products
  USING (organization_id = app_org_id())
  WITH CHECK (organization_id = app_org_id());
GRANT SELECT, INSERT, UPDATE, DELETE ON products TO app_tenant;

ALTER TABLE orders ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON orders;
CREATE POLICY tenant_isolation ON orders
  USING (organization_id = app_org_id())
  WITH CHECK (organization_id = app_org_id());
GRANT SELECT, INSERT, UPDATE, DELETE ON orders TO app_tenant;

ALTER TABLE order_items ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON order_items;
CREATE POLICY tenant_isolation ON order_items
  USING (organization_id = app_org_id())
  WITH CHECK (organization_id = app_org_id());
GRANT SELECT, INSERT, UPDATE, DELETE ON order_items TO app_tenant;

ALTER TABLE invoices ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON invoices;
CREATE POLICY tenant_isolation ON invoices
  USING (organization_id = app_org_id())
  WITH CHECK (organization_id = app_org_id());
GRANT SELECT, INSERT, UPDATE, DELETE ON invoices TO app_tenant;

ALTER TABLE invoice_items ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON invoice_items;
CREATE POLICY tenant_isolation ON invoice_items
  USING (organization_id = app_org_id())
  WITH CHECK (organization_id = app_org_id());
GRANT SELECT, INSERT, UPDATE, DELETE ON invoice_items TO app_tenant;

ALTER TABLE payments ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON payments;
CREATE POLICY tenant_isolation ON payments
  USING (organization_id = app_org_id())
  WITH CHECK (organization_id = app_org_id());
GRANT SELECT, INSERT ON payments TO app_tenant;

ALTER TABLE transactions ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON transactions;
CREATE POLICY tenant_isolation ON transactions
  USING (organization_id = app_org_id())
  WITH CHECK (organization_id = app_org_id());
GRANT SELECT, INSERT, UPDATE, DELETE ON transactions TO app_tenant;

-- assistant_messages: the conversation with the assistant.
ALTER TABLE assistant_messages ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON assistant_messages;
CREATE POLICY tenant_isolation ON assistant_messages
  USING (organization_id = app_org_id())
  WITH CHECK (organization_id = app_org_id());
GRANT SELECT, INSERT, DELETE ON assistant_messages TO app_tenant;

-- Quotes and their lines.
ALTER TABLE quotes ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON quotes;
CREATE POLICY tenant_isolation ON quotes
  USING (organization_id = app_org_id())
  WITH CHECK (organization_id = app_org_id());
GRANT SELECT, INSERT, UPDATE, DELETE ON quotes TO app_tenant;

ALTER TABLE quote_items ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON quote_items;
CREATE POLICY tenant_isolation ON quote_items
  USING (organization_id = app_org_id())
  WITH CHECK (organization_id = app_org_id());
GRANT SELECT, INSERT, UPDATE, DELETE ON quote_items TO app_tenant;

-- payment_reminders: written once, marked as sent.
ALTER TABLE payment_reminders ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON payment_reminders;
CREATE POLICY tenant_isolation ON payment_reminders
  USING (organization_id = app_org_id())
  WITH CHECK (organization_id = app_org_id());
GRANT SELECT, INSERT, UPDATE ON payment_reminders TO app_tenant;

-- Calendar.
ALTER TABLE appointments ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON appointments;
CREATE POLICY tenant_isolation ON appointments
  USING (organization_id = app_org_id())
  WITH CHECK (organization_id = app_org_id());
GRANT SELECT, INSERT, UPDATE, DELETE ON appointments TO app_tenant;

-- Projects and tasks.
ALTER TABLE projects ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON projects;
CREATE POLICY tenant_isolation ON projects
  USING (organization_id = app_org_id())
  WITH CHECK (organization_id = app_org_id());
GRANT SELECT, INSERT, UPDATE, DELETE ON projects TO app_tenant;

ALTER TABLE tasks ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON tasks;
CREATE POLICY tenant_isolation ON tasks
  USING (organization_id = app_org_id())
  WITH CHECK (organization_id = app_org_id());
GRANT SELECT, INSERT, UPDATE, DELETE ON tasks TO app_tenant;

-- Sales pipeline.
ALTER TABLE deals ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON deals;
CREATE POLICY tenant_isolation ON deals
  USING (organization_id = app_org_id())
  WITH CHECK (organization_id = app_org_id());
GRANT SELECT, INSERT, UPDATE, DELETE ON deals TO app_tenant;

-- Inventory: movements are written, never changed.
ALTER TABLE stock_movements ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON stock_movements;
CREATE POLICY tenant_isolation ON stock_movements
  USING (organization_id = app_org_id())
  WITH CHECK (organization_id = app_org_id());
GRANT SELECT, INSERT ON stock_movements TO app_tenant;

ALTER TABLE suppliers ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON suppliers;
CREATE POLICY tenant_isolation ON suppliers
  USING (organization_id = app_org_id())
  WITH CHECK (organization_id = app_org_id());
GRANT SELECT, INSERT, UPDATE, DELETE ON suppliers TO app_tenant;

ALTER TABLE purchase_orders ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON purchase_orders;
CREATE POLICY tenant_isolation ON purchase_orders
  USING (organization_id = app_org_id())
  WITH CHECK (organization_id = app_org_id());
GRANT SELECT, INSERT, UPDATE, DELETE ON purchase_orders TO app_tenant;

ALTER TABLE purchase_order_items ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON purchase_order_items;
CREATE POLICY tenant_isolation ON purchase_order_items
  USING (organization_id = app_org_id())
  WITH CHECK (organization_id = app_org_id());
GRANT SELECT, INSERT, UPDATE, DELETE ON purchase_order_items TO app_tenant;

-- Documents (metadata; the files live in UPLOAD_DIR).
ALTER TABLE documents ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON documents;
CREATE POLICY tenant_isolation ON documents
  USING (organization_id = app_org_id())
  WITH CHECK (organization_id = app_org_id());
GRANT SELECT, INSERT, UPDATE, DELETE ON documents TO app_tenant;

-- Automations and their runs.
ALTER TABLE automations ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON automations;
CREATE POLICY tenant_isolation ON automations
  USING (organization_id = app_org_id())
  WITH CHECK (organization_id = app_org_id());
GRANT SELECT, INSERT, UPDATE, DELETE ON automations TO app_tenant;

ALTER TABLE automation_runs ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON automation_runs;
CREATE POLICY tenant_isolation ON automation_runs
  USING (organization_id = app_org_id())
  WITH CHECK (organization_id = app_org_id());
GRANT SELECT, INSERT, UPDATE ON automation_runs TO app_tenant;

-- Dashboards, Creator Studio and social channels.
DO $$
DECLARE
  t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['dashboards', 'content_items', 'content_comments', 'content_templates', 'content_generations', 'social_accounts', 'social_stats', 'recurring_invoices', 'bank_transactions', 'client_contacts', 'client_activities', 'time_entries', 'departments', 'sponsorships', 'goals', 'habits', 'habit_checks', 'custom_roles', 'user_preferences', 'notifications', 'insight_dismissals', 'task_dependencies', 'task_comments', 'project_members', 'assistant_conversations', 'assistant_memories', 'assistant_actions', 'daily_summaries', 'ai_agents', 'employee_profiles', 'absences', 'business_units', 'chat_channels', 'chat_members', 'chat_messages', 'personal_transactions', 'content_stats', 'invoice_templates', 'invoice_files', 'invoice_deliveries', 'product_categories', 'product_variants', 'product_images', 'product_suppliers', 'supplier_price_history', 'product_imports', 'order_events', 'stores', 'shop_payment_events', 'supplier_orders', 'supplier_order_items', 'shipments', 'shipment_events', 'returns', 'return_items', 'return_events', 'supplier_returns', 'refunds'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('DROP POLICY IF EXISTS tenant_isolation ON %I', t);
    EXECUTE format('CREATE POLICY tenant_isolation ON %I USING (organization_id = app_org_id()) WITH CHECK (organization_id = app_org_id())', t);
    EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON %I TO app_tenant', t);
  END LOOP;
END
$$;

-- An issued invoice is a document: its figures and lines never change again.
-- Only the payment state moves (paid_cents, status) and a credit note may
-- mark it CANCELLED. Enforced here, below any application code.
CREATE OR REPLACE FUNCTION invoices_guard() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    -- Deleting a whole company (its owner, after the export; src/server/privacy.ts).
    IF current_setting('app.purge_org', true) = OLD.organization_id::text THEN
      RETURN OLD;
    END IF;
    IF OLD.status <> 'DRAFT' THEN
      RAISE EXCEPTION 'issued invoice % cannot be deleted', OLD.number USING ERRCODE = 'check_violation';
    END IF;
    RETURN OLD;
  END IF;
  IF OLD.status <> 'DRAFT' AND (
       NEW.number IS DISTINCT FROM OLD.number OR NEW.net_cents <> OLD.net_cents
    OR NEW.vat_cents <> OLD.vat_cents OR NEW.gross_cents <> OLD.gross_cents
    OR NEW.client_id <> OLD.client_id OR NEW.issue_date IS DISTINCT FROM OLD.issue_date
    OR NEW.buyer_snapshot IS DISTINCT FROM OLD.buyer_snapshot
    OR NEW.seller_snapshot IS DISTINCT FROM OLD.seller_snapshot
    OR NEW.kind <> OLD.kind OR NEW.status = 'DRAFT'
    OR NEW.currency IS DISTINCT FROM OLD.currency OR NEW.exchange_rate IS DISTINCT FROM OLD.exchange_rate
    OR NEW.title IS DISTINCT FROM OLD.title OR NEW.notes IS DISTINCT FROM OLD.notes
    OR NEW.service_date IS DISTINCT FROM OLD.service_date OR NEW.service_end_date IS DISTINCT FROM OLD.service_end_date
    OR NEW.due_date IS DISTINCT FROM OLD.due_date OR NEW.language <> OLD.language
    OR NEW.tax_treatment <> OLD.tax_treatment OR NEW.exemption_reason IS DISTINCT FROM OLD.exemption_reason
    OR NEW.small_business <> OLD.small_business OR NEW.template_snapshot IS DISTINCT FROM OLD.template_snapshot
    OR NEW.corrects_id IS DISTINCT FROM OLD.corrects_id) THEN
    RAISE EXCEPTION 'issued invoice % cannot be changed', OLD.number USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END
$$;
DROP TRIGGER IF EXISTS invoices_guard ON invoices;
CREATE TRIGGER invoices_guard BEFORE UPDATE OR DELETE ON invoices
  FOR EACH ROW EXECUTE FUNCTION invoices_guard();

CREATE OR REPLACE FUNCTION invoice_items_guard() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  state text;
BEGIN
  IF TG_OP = 'DELETE' AND current_setting('app.purge_org', true) = OLD.organization_id::text THEN
    RETURN OLD;
  END IF;
  SELECT status INTO state FROM invoices WHERE id = COALESCE(NEW.invoice_id, OLD.invoice_id);
  IF state IS NOT NULL AND state <> 'DRAFT' THEN
    RAISE EXCEPTION 'lines of an issued invoice cannot be changed' USING ERRCODE = 'check_violation';
  END IF;
  RETURN COALESCE(NEW, OLD);
END
$$;
DROP TRIGGER IF EXISTS invoice_items_guard ON invoice_items;
CREATE TRIGGER invoice_items_guard BEFORE INSERT OR UPDATE OR DELETE ON invoice_items
  FOR EACH ROW EXECUTE FUNCTION invoice_items_guard();

-- What was sent and what was tried is history: rows are added, never changed.
CREATE OR REPLACE FUNCTION invoice_history_guard() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' AND current_setting('app.purge_org', true) = OLD.organization_id::text THEN
    RETURN OLD;
  END IF;
  RAISE EXCEPTION '% of an invoice cannot be changed', TG_TABLE_NAME USING ERRCODE = 'check_violation';
END
$$;
DROP TRIGGER IF EXISTS invoice_files_guard ON invoice_files;
CREATE TRIGGER invoice_files_guard BEFORE UPDATE OR DELETE ON invoice_files
  FOR EACH ROW EXECUTE FUNCTION invoice_history_guard();
DROP TRIGGER IF EXISTS invoice_deliveries_guard ON invoice_deliveries;
CREATE TRIGGER invoice_deliveries_guard BEFORE UPDATE OR DELETE ON invoice_deliveries
  FOR EACH ROW EXECUTE FUNCTION invoice_history_guard();
