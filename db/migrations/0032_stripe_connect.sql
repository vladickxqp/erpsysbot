ALTER TABLE "stores" ADD COLUMN "stripe_account_id" text;--> statement-breakpoint
ALTER TABLE "stores" ADD COLUMN "stripe_account_ready" boolean DEFAULT false NOT NULL;