CREATE TABLE "departments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"name" text NOT NULL,
	"manager_user_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "goals" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"title" text NOT NULL,
	"target_date" date,
	"progress" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "habit_checks" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"habit_id" uuid NOT NULL,
	"day" date NOT NULL
);
--> statement-breakpoint
CREATE TABLE "habits" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"title" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sponsorships" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"brand" text NOT NULL,
	"title" text,
	"status" text DEFAULT 'LEAD' NOT NULL,
	"amount_cents" integer DEFAULT 0 NOT NULL,
	"due_date" date,
	"client_id" uuid,
	"content_id" uuid,
	"invoice_id" uuid,
	"notes" text,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "clients" ADD COLUMN "archived_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "memberships" ADD COLUMN "department_id" uuid;--> statement-breakpoint
ALTER TABLE "memberships" ADD COLUMN "calendar_token_hash" text;--> statement-breakpoint
ALTER TABLE "organizations" ADD COLUMN "logo_document_id" uuid;--> statement-breakpoint
ALTER TABLE "habit_checks" ADD CONSTRAINT "habit_checks_habit_id_habits_id_fk" FOREIGN KEY ("habit_id") REFERENCES "public"."habits"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sponsorships" ADD CONSTRAINT "sponsorships_client_id_clients_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."clients"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sponsorships" ADD CONSTRAINT "sponsorships_content_id_content_items_id_fk" FOREIGN KEY ("content_id") REFERENCES "public"."content_items"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "departments_org_name_key" ON "departments" USING btree ("organization_id","name");--> statement-breakpoint
CREATE INDEX "goals_user_idx" ON "goals" USING btree ("organization_id","user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "habit_checks_day_key" ON "habit_checks" USING btree ("habit_id","day");--> statement-breakpoint
CREATE INDEX "habits_user_idx" ON "habits" USING btree ("organization_id","user_id");--> statement-breakpoint
CREATE INDEX "sponsorships_org_idx" ON "sponsorships" USING btree ("organization_id","status");--> statement-breakpoint
UPDATE "organizations" SET "disabled_modules" = array_append("disabled_modules", 'personal') WHERE "workspace_type" IS DISTINCT FROM 'PERSONAL';
