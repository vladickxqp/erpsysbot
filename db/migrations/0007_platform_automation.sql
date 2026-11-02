CREATE TYPE "public"."subscription_status" AS ENUM('TRIALING', 'ACTIVE', 'PAST_DUE', 'CANCELED', 'NONE');--> statement-breakpoint
CREATE TABLE "automation_runs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"automation_id" uuid NOT NULL,
	"subject" text NOT NULL,
	"ok" boolean NOT NULL,
	"message" text,
	"attempts" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "automations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"name" text NOT NULL,
	"trigger" text NOT NULL,
	"conditions" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"action" text NOT NULL,
	"params" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "billing_events" (
	"id" text PRIMARY KEY NOT NULL,
	"type" text NOT NULL,
	"organization_id" uuid,
	"amount_cents" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "plans" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"price_cents" integer DEFAULT 0 NOT NULL,
	"max_users" integer DEFAULT 1 NOT NULL,
	"ai_per_day" integer DEFAULT 0 NOT NULL,
	"modules" text[] DEFAULT '{}'::text[] NOT NULL,
	"stripe_price_id" text,
	"active" boolean DEFAULT true NOT NULL,
	"position" integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "platform_invites" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"email" text NOT NULL,
	"token_hash" text NOT NULL,
	"created_by" uuid,
	"expires_at" timestamp with time zone NOT NULL,
	"used_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "subscriptions" (
	"organization_id" uuid PRIMARY KEY NOT NULL,
	"plan_id" text,
	"status" "subscription_status" DEFAULT 'TRIALING' NOT NULL,
	"trial_ends_at" timestamp with time zone,
	"current_period_end" timestamp with time zone,
	"cancel_at_period_end" boolean DEFAULT false NOT NULL,
	"stripe_customer_id" text,
	"stripe_subscription_id" text,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "suspensions" (
	"organization_id" uuid PRIMARY KEY NOT NULL,
	"reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "assistant_messages" ADD COLUMN "input_tokens" integer;--> statement-breakpoint
ALTER TABLE "assistant_messages" ADD COLUMN "output_tokens" integer;--> statement-breakpoint
ALTER TABLE "assistant_messages" ADD COLUMN "tools" text[];--> statement-breakpoint
ALTER TABLE "clients" ADD COLUMN "buyer_reference" text;--> statement-breakpoint
ALTER TABLE "automation_runs" ADD CONSTRAINT "automation_runs_automation_id_automations_id_fk" FOREIGN KEY ("automation_id") REFERENCES "public"."automations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "platform_invites" ADD CONSTRAINT "platform_invites_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "subscriptions" ADD CONSTRAINT "subscriptions_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "subscriptions" ADD CONSTRAINT "subscriptions_plan_id_plans_id_fk" FOREIGN KEY ("plan_id") REFERENCES "public"."plans"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "suspensions" ADD CONSTRAINT "suspensions_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "automation_runs_once_key" ON "automation_runs" USING btree ("automation_id","subject");--> statement-breakpoint
CREATE INDEX "automation_runs_org_idx" ON "automation_runs" USING btree ("organization_id","created_at");--> statement-breakpoint
CREATE INDEX "automations_org_trigger_idx" ON "automations" USING btree ("organization_id","trigger");--> statement-breakpoint
CREATE UNIQUE INDEX "platform_invites_token_key" ON "platform_invites" USING btree ("token_hash");--> statement-breakpoint
-- The three plans of the price list; limits and modules are edited later in /admin.
INSERT INTO "plans" ("id", "name", "price_cents", "max_users", "ai_per_day", "modules", "position") VALUES
  ('starter', 'Starter', 1900, 2, 20, '{crm,orders,calendar}', 1),
  ('business', 'Business', 3900, 10, 100, '{crm,orders,calendar,invoices,finance,team,telegram,assistant,reports,tasks,documents}', 2),
  ('professional', 'Professional', 6900, 50, 300, '{crm,orders,calendar,invoices,finance,team,telegram,assistant,reports,tasks,documents,inventory,automation}', 3)
ON CONFLICT ("id") DO NOTHING;--> statement-breakpoint
-- Companies that exist already keep everything they have.
INSERT INTO "subscriptions" ("organization_id", "plan_id", "status")
SELECT "id", 'professional', 'ACTIVE' FROM "organizations"
ON CONFLICT ("organization_id") DO NOTHING;
