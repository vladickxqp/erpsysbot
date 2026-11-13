ALTER TABLE "dashboards" ADD COLUMN "area" text;--> statement-breakpoint
ALTER TABLE "organizations" ADD COLUMN "areas" text[] DEFAULT '{}'::text[] NOT NULL;--> statement-breakpoint
ALTER TABLE "plans" ADD COLUMN "areas" text[] DEFAULT '{}'::text[] NOT NULL;
--> statement-breakpoint
-- The plans by area: ERP, Creator, Commerce and all of them, each as Start and Pro.
-- Suggested prices; they stay off the price list until switched on in /admin.
INSERT INTO "plans" ("id", "name", "price_cents", "max_users", "ai_per_day", "modules", "areas", "active", "position") VALUES
  ('erp-start', 'ERP Start', 1900, 3, 30, '{telegram}', '{business}', false, 10),
  ('erp-pro', 'ERP Pro', 4900, 15, 150, '{telegram}', '{business}', false, 11),
  ('creator-start', 'Creator Start', 900, 1, 30, '{telegram}', '{creator}', false, 20),
  ('creator-pro', 'Creator Pro', 2900, 5, 150, '{telegram}', '{creator}', false, 21),
  ('commerce-start', 'Commerce Start', 2900, 3, 30, '{telegram}', '{commerce}', false, 30),
  ('commerce-pro', 'Commerce Pro', 6900, 15, 150, '{telegram}', '{commerce}', false, 31),
  ('complete-start', 'Komplett Start', 4900, 5, 100, '{telegram}', '{commerce,creator,business}', false, 40),
  ('complete-pro', 'Komplett Pro', 9900, 25, 300, '{telegram}', '{commerce,creator,business}', false, 41)
ON CONFLICT ("id") DO NOTHING;
