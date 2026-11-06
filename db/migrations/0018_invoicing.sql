CREATE TYPE "public"."invoice_delivery_status" AS ENUM('SENT', 'FAILED');--> statement-breakpoint
CREATE TYPE "public"."invoice_file_kind" AS ENUM('PDF', 'ZUGFERD', 'XRECHNUNG');--> statement-breakpoint
CREATE TYPE "public"."invoice_tax_treatment" AS ENUM('STANDARD', 'SMALL_BUSINESS', 'REVERSE_CHARGE', 'INTRA_EU', 'EXPORT', 'EXEMPT', 'NOT_TAXABLE');--> statement-breakpoint
ALTER TYPE "public"."invoice_status" ADD VALUE 'CREDITED';--> statement-breakpoint
CREATE TABLE "invoice_deliveries" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"invoice_id" uuid NOT NULL,
	"status" "invoice_delivery_status" NOT NULL,
	"format" "invoice_file_kind" NOT NULL,
	"recipient" text NOT NULL,
	"subject" text NOT NULL,
	"message_id" text,
	"error" text,
	"sent_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "invoice_files" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"invoice_id" uuid NOT NULL,
	"kind" "invoice_file_kind" NOT NULL,
	"name" text NOT NULL,
	"mime_type" text NOT NULL,
	"size_bytes" integer NOT NULL,
	"sha256" text NOT NULL,
	"storage_key" text NOT NULL,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "invoice_templates" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"name" text NOT NULL,
	"layout" text DEFAULT 'CLASSIC' NOT NULL,
	"accent_color" text DEFAULT '#2563eb' NOT NULL,
	"language" text DEFAULT 'de' NOT NULL,
	"footer" text,
	"payment_instructions" text,
	"is_default" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "invoices" ADD COLUMN "title" text;--> statement-breakpoint
ALTER TABLE "invoices" ADD COLUMN "service_end_date" date;--> statement-breakpoint
ALTER TABLE "invoices" ADD COLUMN "language" text DEFAULT 'de' NOT NULL;--> statement-breakpoint
ALTER TABLE "invoices" ADD COLUMN "tax_treatment" "invoice_tax_treatment" DEFAULT 'STANDARD' NOT NULL;--> statement-breakpoint
ALTER TABLE "invoices" ADD COLUMN "exemption_reason" text;--> statement-breakpoint
ALTER TABLE "invoices" ADD COLUMN "template_id" uuid;--> statement-breakpoint
ALTER TABLE "invoices" ADD COLUMN "template_snapshot" jsonb;--> statement-breakpoint
ALTER TABLE "invoices" ADD COLUMN "credited_cents" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "invoices" ADD COLUMN "sent_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "invoices" ADD COLUMN "request_id" text;--> statement-breakpoint
ALTER TABLE "organizations" ADD COLUMN "einvoice_format" text DEFAULT 'PDF' NOT NULL;--> statement-breakpoint
ALTER TABLE "invoice_deliveries" ADD CONSTRAINT "invoice_deliveries_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invoice_deliveries" ADD CONSTRAINT "invoice_deliveries_invoice_id_invoices_id_fk" FOREIGN KEY ("invoice_id") REFERENCES "public"."invoices"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invoice_files" ADD CONSTRAINT "invoice_files_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invoice_files" ADD CONSTRAINT "invoice_files_invoice_id_invoices_id_fk" FOREIGN KEY ("invoice_id") REFERENCES "public"."invoices"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invoice_templates" ADD CONSTRAINT "invoice_templates_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "invoice_deliveries_invoice_idx" ON "invoice_deliveries" USING btree ("invoice_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "invoice_files_invoice_kind_key" ON "invoice_files" USING btree ("invoice_id","kind");--> statement-breakpoint
CREATE UNIQUE INDEX "invoice_templates_org_name_key" ON "invoice_templates" USING btree ("organization_id","name");--> statement-breakpoint
CREATE UNIQUE INDEX "invoice_templates_org_default_key" ON "invoice_templates" USING btree ("organization_id") WHERE "invoice_templates"."is_default";--> statement-breakpoint
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_template_id_invoice_templates_id_fk" FOREIGN KEY ("template_id") REFERENCES "public"."invoice_templates"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "invoices_org_request_key" ON "invoices" USING btree ("organization_id","request_id");--> statement-breakpoint
UPDATE "invoices" SET "tax_treatment" = 'SMALL_BUSINESS' WHERE "small_business";--> statement-breakpoint
UPDATE "invoices" i SET "language" = o."locale" FROM "organizations" o WHERE o."id" = i."organization_id";
