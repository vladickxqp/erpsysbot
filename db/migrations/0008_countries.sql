ALTER TABLE "invoice_items" ALTER COLUMN "vat_rate" SET DATA TYPE numeric(6, 3);--> statement-breakpoint
ALTER TABLE "order_items" ALTER COLUMN "vat_rate" SET DATA TYPE numeric(6, 3);--> statement-breakpoint
ALTER TABLE "products" ALTER COLUMN "vat_rate" SET DATA TYPE numeric(6, 3);--> statement-breakpoint
ALTER TABLE "products" ALTER COLUMN "vat_rate" SET DEFAULT 19;--> statement-breakpoint
ALTER TABLE "quote_items" ALTER COLUMN "vat_rate" SET DATA TYPE numeric(6, 3);--> statement-breakpoint
ALTER TABLE "organizations" ADD COLUMN "tax_rates" numeric(6, 3)[];--> statement-breakpoint
ALTER TABLE "organizations" ADD COLUMN "signup_ip_country" text;--> statement-breakpoint
ALTER TABLE "suspensions" ADD COLUMN "kind" text DEFAULT 'SUSPENDED' NOT NULL;