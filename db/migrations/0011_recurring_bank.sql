CREATE TYPE "public"."bank_entry_status" AS ENUM('NEW', 'MATCHED', 'BOOKED', 'IGNORED');--> statement-breakpoint
CREATE TABLE "bank_transactions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"booked_on" date NOT NULL,
	"amount_cents" integer NOT NULL,
	"currency" text DEFAULT 'EUR' NOT NULL,
	"counterparty" text,
	"counterparty_iban" text,
	"purpose" text,
	"dedupe_key" text NOT NULL,
	"status" "bank_entry_status" DEFAULT 'NEW' NOT NULL,
	"invoice_id" uuid,
	"transaction_id" uuid,
	"imported_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "recurring_invoices" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"client_id" uuid NOT NULL,
	"title" text,
	"items" jsonb NOT NULL,
	"interval" text NOT NULL,
	"anchor_day" integer NOT NULL,
	"next_date" date NOT NULL,
	"end_date" date,
	"auto_issue" boolean DEFAULT false NOT NULL,
	"auto_send" boolean DEFAULT false NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"last_invoice_id" uuid,
	"last_error" text,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "organizations" ADD COLUMN "datev" jsonb;--> statement-breakpoint
ALTER TABLE "recurring_invoices" ADD CONSTRAINT "recurring_invoices_client_id_clients_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."clients"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "bank_transactions_dedupe_key" ON "bank_transactions" USING btree ("organization_id","dedupe_key");--> statement-breakpoint
CREATE INDEX "bank_transactions_org_idx" ON "bank_transactions" USING btree ("organization_id","status","booked_on");--> statement-breakpoint
CREATE INDEX "recurring_invoices_due_idx" ON "recurring_invoices" USING btree ("organization_id","active","next_date");