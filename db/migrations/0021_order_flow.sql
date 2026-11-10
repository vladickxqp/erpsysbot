CREATE TABLE "order_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"order_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"data" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"user_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "invoice_items" ADD COLUMN "variant_id" uuid;--> statement-breakpoint
ALTER TABLE "order_items" ADD COLUMN "variant_id" uuid;--> statement-breakpoint
ALTER TABLE "orders" ADD COLUMN "channel" text DEFAULT 'MANUAL' NOT NULL;--> statement-breakpoint
ALTER TABLE "orders" ADD COLUMN "external_ref" text;--> statement-breakpoint
ALTER TABLE "orders" ADD COLUMN "fulfillment_status" text DEFAULT 'UNFULFILLED' NOT NULL;--> statement-breakpoint
ALTER TABLE "orders" ADD COLUMN "payment_status" text DEFAULT 'UNPAID' NOT NULL;--> statement-breakpoint
ALTER TABLE "orders" ADD COLUMN "ship_name" text;--> statement-breakpoint
ALTER TABLE "orders" ADD COLUMN "ship_street" text;--> statement-breakpoint
ALTER TABLE "orders" ADD COLUMN "ship_postal_code" text;--> statement-breakpoint
ALTER TABLE "orders" ADD COLUMN "ship_city" text;--> statement-breakpoint
ALTER TABLE "orders" ADD COLUMN "ship_country" text;--> statement-breakpoint
ALTER TABLE "orders" ADD COLUMN "carrier" text;--> statement-breakpoint
ALTER TABLE "orders" ADD COLUMN "tracking_number" text;--> statement-breakpoint
ALTER TABLE "orders" ADD COLUMN "confirmed_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "orders" ADD COLUMN "paid_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "orders" ADD COLUMN "shipped_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "orders" ADD COLUMN "delivered_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "orders" ADD COLUMN "cancelled_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "quote_items" ADD COLUMN "variant_id" uuid;--> statement-breakpoint
ALTER TABLE "order_events" ADD CONSTRAINT "order_events_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "order_events" ADD CONSTRAINT "order_events_order_id_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."orders"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "order_events_order_idx" ON "order_events" USING btree ("order_id","created_at");--> statement-breakpoint
CREATE INDEX "orders_org_fulfillment_idx" ON "orders" USING btree ("organization_id","fulfillment_status");--> statement-breakpoint
UPDATE "orders" SET "fulfillment_status" = 'CANCELLED' WHERE "status" = 'CANCELLED';--> statement-breakpoint
UPDATE "orders" o SET "fulfillment_status" = 'DELIVERED' WHERE o."status" = 'COMPLETED' AND EXISTS (SELECT 1 FROM "order_items" i WHERE i."order_id" = o."id" AND i."product_id" IS NOT NULL);
