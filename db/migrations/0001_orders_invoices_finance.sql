CREATE TYPE "public"."invoice_kind" AS ENUM('INVOICE', 'CREDIT_NOTE');--> statement-breakpoint
CREATE TYPE "public"."invoice_status" AS ENUM('DRAFT', 'ISSUED', 'PARTIALLY_PAID', 'PAID', 'CANCELLED');--> statement-breakpoint
CREATE TYPE "public"."order_status" AS ENUM('DRAFT', 'NEW', 'CONFIRMED', 'IN_PROGRESS', 'WAITING', 'COMPLETED', 'CANCELLED');--> statement-breakpoint
CREATE TYPE "public"."product_kind" AS ENUM('PRODUCT', 'SERVICE');--> statement-breakpoint
CREATE TYPE "public"."transaction_type" AS ENUM('INCOME', 'EXPENSE', 'REFUND', 'ADJUSTMENT');--> statement-breakpoint
CREATE TABLE "invoice_items" (
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
	"invoice_id" uuid NOT NULL
);
--> statement-breakpoint
CREATE TABLE "invoices" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"kind" "invoice_kind" DEFAULT 'INVOICE' NOT NULL,
	"status" "invoice_status" DEFAULT 'DRAFT' NOT NULL,
	"number" text,
	"client_id" uuid NOT NULL,
	"order_id" uuid,
	"corrects_id" uuid,
	"issue_date" date,
	"service_date" date,
	"due_date" date,
	"notes" text,
	"seller_snapshot" jsonb,
	"buyer_snapshot" jsonb,
	"net_cents" integer DEFAULT 0 NOT NULL,
	"vat_cents" integer DEFAULT 0 NOT NULL,
	"gross_cents" integer DEFAULT 0 NOT NULL,
	"paid_cents" integer DEFAULT 0 NOT NULL,
	"small_business" boolean DEFAULT false NOT NULL,
	"issued_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "order_items" (
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
	"order_id" uuid NOT NULL
);
--> statement-breakpoint
CREATE TABLE "orders" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"number" integer NOT NULL,
	"client_id" uuid NOT NULL,
	"status" "order_status" DEFAULT 'NEW' NOT NULL,
	"title" text,
	"notes" text,
	"due_date" date,
	"assigned_user_id" uuid,
	"net_cents" integer DEFAULT 0 NOT NULL,
	"vat_cents" integer DEFAULT 0 NOT NULL,
	"gross_cents" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "payments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"invoice_id" uuid NOT NULL,
	"amount_cents" integer NOT NULL,
	"paid_on" date NOT NULL,
	"method" text DEFAULT 'TRANSFER' NOT NULL,
	"note" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "products" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"kind" "product_kind" DEFAULT 'SERVICE' NOT NULL,
	"name" text NOT NULL,
	"sku" text,
	"description" text,
	"unit" text DEFAULT 'Stk' NOT NULL,
	"price_cents" integer DEFAULT 0 NOT NULL,
	"vat_rate" integer DEFAULT 19 NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "transactions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"type" "transaction_type" NOT NULL,
	"amount_cents" integer NOT NULL,
	"booked_on" date NOT NULL,
	"category" text,
	"description" text,
	"method" text,
	"invoice_id" uuid,
	"payment_id" uuid,
	"client_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "organizations" ADD COLUMN "bic" text;--> statement-breakpoint
ALTER TABLE "organizations" ADD COLUMN "bank_name" text;--> statement-breakpoint
ALTER TABLE "organizations" ADD COLUMN "tax_number" text;--> statement-breakpoint
ALTER TABLE "organizations" ADD COLUMN "website" text;--> statement-breakpoint
ALTER TABLE "organizations" ADD COLUMN "small_business" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "organizations" ADD COLUMN "payment_terms_days" integer DEFAULT 14 NOT NULL;--> statement-breakpoint
ALTER TABLE "organizations" ADD COLUMN "invoice_number_format" text DEFAULT 'RE-{YYYY}-{NNNN}' NOT NULL;--> statement-breakpoint
ALTER TABLE "organizations" ADD COLUMN "credit_note_number_format" text DEFAULT 'GS-{YYYY}-{NNNN}' NOT NULL;--> statement-breakpoint
ALTER TABLE "organizations" ADD COLUMN "invoice_footer" text;--> statement-breakpoint
ALTER TABLE "invoice_items" ADD CONSTRAINT "invoice_items_invoice_id_invoices_id_fk" FOREIGN KEY ("invoice_id") REFERENCES "public"."invoices"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_client_id_clients_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."clients"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_order_id_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."orders"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "order_items" ADD CONSTRAINT "order_items_order_id_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."orders"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "orders" ADD CONSTRAINT "orders_client_id_clients_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."clients"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payments" ADD CONSTRAINT "payments_invoice_id_invoices_id_fk" FOREIGN KEY ("invoice_id") REFERENCES "public"."invoices"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "invoice_items_invoice_idx" ON "invoice_items" USING btree ("invoice_id");--> statement-breakpoint
CREATE UNIQUE INDEX "invoices_org_number_key" ON "invoices" USING btree ("organization_id","number");--> statement-breakpoint
CREATE INDEX "invoices_org_status_idx" ON "invoices" USING btree ("organization_id","status");--> statement-breakpoint
CREATE INDEX "invoices_client_idx" ON "invoices" USING btree ("client_id");--> statement-breakpoint
CREATE INDEX "order_items_order_idx" ON "order_items" USING btree ("order_id");--> statement-breakpoint
CREATE UNIQUE INDEX "orders_org_number_key" ON "orders" USING btree ("organization_id","number");--> statement-breakpoint
CREATE INDEX "orders_org_status_idx" ON "orders" USING btree ("organization_id","status");--> statement-breakpoint
CREATE INDEX "orders_client_idx" ON "orders" USING btree ("client_id");--> statement-breakpoint
CREATE INDEX "payments_invoice_idx" ON "payments" USING btree ("invoice_id");--> statement-breakpoint
CREATE INDEX "products_org_name_idx" ON "products" USING btree ("organization_id","name");--> statement-breakpoint
CREATE INDEX "transactions_org_date_idx" ON "transactions" USING btree ("organization_id","booked_on");