CREATE TYPE "public"."content_status" AS ENUM('IDEA', 'DRAFT', 'REVIEW', 'SCHEDULED', 'PUBLISHED');--> statement-breakpoint
CREATE TABLE "content_comments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"content_id" uuid NOT NULL,
	"user_id" uuid,
	"body" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "content_generations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"input_tokens" integer,
	"output_tokens" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "content_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"title" text NOT NULL,
	"body" text,
	"description" text,
	"platform" text DEFAULT 'OTHER' NOT NULL,
	"content_type" text DEFAULT 'POST' NOT NULL,
	"status" "content_status" DEFAULT 'DRAFT' NOT NULL,
	"category" text,
	"hashtags" text[] DEFAULT '{}'::text[] NOT NULL,
	"media_ids" uuid[] DEFAULT '{}'::uuid[] NOT NULL,
	"scheduled_at" timestamp with time zone,
	"published_at" timestamp with time zone,
	"social_account_id" uuid,
	"external_url" text,
	"assigned_user_id" uuid,
	"project_id" uuid,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "content_templates" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"name" text NOT NULL,
	"platform" text DEFAULT 'OTHER' NOT NULL,
	"content_type" text DEFAULT 'POST' NOT NULL,
	"body" text NOT NULL,
	"hashtags" text[] DEFAULT '{}'::text[] NOT NULL,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "dashboards" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"name" text NOT NULL,
	"position" integer DEFAULT 0 NOT NULL,
	"widgets" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "social_accounts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"provider" text NOT NULL,
	"name" text NOT NULL,
	"external_id" text NOT NULL,
	"url" text,
	"last_fetched_at" timestamp with time zone,
	"last_error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "social_stats" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"account_id" uuid NOT NULL,
	"day" date NOT NULL,
	"followers" integer,
	"views" numeric(20, 0),
	"posts" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "documents" ADD COLUMN "collection" text;--> statement-breakpoint
ALTER TABLE "memberships" ADD COLUMN "hidden_modules" text[] DEFAULT '{}'::text[] NOT NULL;--> statement-breakpoint
ALTER TABLE "organizations" ADD COLUMN "disabled_modules" text[] DEFAULT '{}'::text[] NOT NULL;--> statement-breakpoint
ALTER TABLE "content_comments" ADD CONSTRAINT "content_comments_content_id_content_items_id_fk" FOREIGN KEY ("content_id") REFERENCES "public"."content_items"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "content_items" ADD CONSTRAINT "content_items_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "dashboards" ADD CONSTRAINT "dashboards_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "social_stats" ADD CONSTRAINT "social_stats_account_id_social_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."social_accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "content_comments_item_idx" ON "content_comments" USING btree ("content_id","created_at");--> statement-breakpoint
CREATE INDEX "content_generations_org_idx" ON "content_generations" USING btree ("organization_id","created_at");--> statement-breakpoint
CREATE INDEX "content_items_org_scheduled_idx" ON "content_items" USING btree ("organization_id","scheduled_at");--> statement-breakpoint
CREATE INDEX "content_items_org_status_idx" ON "content_items" USING btree ("organization_id","status");--> statement-breakpoint
CREATE INDEX "content_templates_org_idx" ON "content_templates" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "dashboards_user_idx" ON "dashboards" USING btree ("organization_id","user_id","position");--> statement-breakpoint
CREATE UNIQUE INDEX "social_accounts_key" ON "social_accounts" USING btree ("organization_id","provider","external_id");--> statement-breakpoint
CREATE UNIQUE INDEX "social_stats_day_key" ON "social_stats" USING btree ("account_id","day");--> statement-breakpoint
CREATE INDEX "social_stats_org_day_idx" ON "social_stats" USING btree ("organization_id","day");