CREATE TYPE "public"."quote_status" AS ENUM('DRAFT', 'SENT', 'ACCEPTED', 'DECLINED');--> statement-breakpoint
CREATE TABLE "payment_reminders" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"invoice_id" uuid NOT NULL,
	"level" integer NOT NULL,
	"issue_date" date NOT NULL,
	"due_date" date NOT NULL,
	"open_cents" integer NOT NULL,
	"fee_cents" integer DEFAULT 0 NOT NULL,
	"sent_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "quote_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"position" integer NOT NULL,
	"product_id" uuid,
	"description" text NOT NULL,
	"quantity" numeric(12, 3) NOT NULL,
	"unit" text DEFAULT 'Stk' NOT NULL,
	"unit_price_cents" integer NOT NULL,
	"discount_percent" numeric(5, 2) DEFAULT '0' NOT NULL,
	"vat_rate" integer NOT NULL,
	"net_cents" integer NOT NULL,
	"quote_id" uuid NOT NULL
);
--> statement-breakpoint
CREATE TABLE "quotes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"number" text NOT NULL,
	"client_id" uuid NOT NULL,
	"status" "quote_status" DEFAULT 'DRAFT' NOT NULL,
	"title" text,
	"notes" text,
	"issue_date" date NOT NULL,
	"valid_until" date,
	"net_cents" integer DEFAULT 0 NOT NULL,
	"vat_cents" integer DEFAULT 0 NOT NULL,
	"gross_cents" integer DEFAULT 0 NOT NULL,
	"small_business" boolean DEFAULT false NOT NULL,
	"order_id" uuid,
	"invoice_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "organizations" ADD COLUMN "quote_number_format" text DEFAULT 'AN-{YYYY}-{NNNN}' NOT NULL;--> statement-breakpoint
ALTER TABLE "telegram_links" ADD COLUMN "notify" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "telegram_links" ADD COLUMN "last_digest_on" date;--> statement-breakpoint
ALTER TABLE "payment_reminders" ADD CONSTRAINT "payment_reminders_invoice_id_invoices_id_fk" FOREIGN KEY ("invoice_id") REFERENCES "public"."invoices"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "quote_items" ADD CONSTRAINT "quote_items_quote_id_quotes_id_fk" FOREIGN KEY ("quote_id") REFERENCES "public"."quotes"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "quotes" ADD CONSTRAINT "quotes_client_id_clients_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."clients"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "payment_reminders_invoice_level_key" ON "payment_reminders" USING btree ("invoice_id","level");--> statement-breakpoint
CREATE INDEX "quote_items_quote_idx" ON "quote_items" USING btree ("quote_id");--> statement-breakpoint
CREATE UNIQUE INDEX "quotes_org_number_key" ON "quotes" USING btree ("organization_id","number");--> statement-breakpoint
CREATE INDEX "quotes_client_idx" ON "quotes" USING btree ("client_id");