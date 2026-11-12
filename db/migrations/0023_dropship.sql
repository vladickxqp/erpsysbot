CREATE TABLE "supplier_order_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"supplier_order_id" uuid NOT NULL,
	"order_item_id" uuid,
	"product_id" uuid NOT NULL,
	"variant_id" uuid,
	"offer_id" uuid,
	"supplier_sku" text,
	"description" text NOT NULL,
	"quantity" numeric(12, 3) NOT NULL,
	"unit_cost_cents" integer NOT NULL,
	"shipping_cost_cents" integer DEFAULT 0 NOT NULL,
	"sale_cents" integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "supplier_orders" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"number" integer NOT NULL,
	"order_id" uuid NOT NULL,
	"supplier_id" uuid NOT NULL,
	"status" text DEFAULT 'WAITING' NOT NULL,
	"method" text NOT NULL,
	"reasons" text[] DEFAULT '{}'::text[] NOT NULL,
	"cost_cents" integer DEFAULT 0 NOT NULL,
	"sale_cents" integer DEFAULT 0 NOT NULL,
	"currency" text NOT NULL,
	"idempotency_key" text NOT NULL,
	"external_ref" text,
	"attempts" integer DEFAULT 0 NOT NULL,
	"next_attempt_at" timestamp with time zone,
	"last_error" text,
	"approved_by" uuid,
	"approved_at" timestamp with time zone,
	"submitted_at" timestamp with time zone,
	"confirmed_at" timestamp with time zone,
	"shipped_at" timestamp with time zone,
	"delivered_at" timestamp with time zone,
	"cancelled_at" timestamp with time zone,
	"carrier" text,
	"tracking_number" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "product_suppliers" ADD COLUMN "supplier_stock" numeric(12, 3);--> statement-breakpoint
ALTER TABLE "product_suppliers" ADD COLUMN "stock_reported_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "product_suppliers" ADD COLUMN "price_changed_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "product_suppliers" ADD COLUMN "previous_price_cents" integer;--> statement-breakpoint
ALTER TABLE "products" ADD COLUMN "fulfillment" text DEFAULT 'STOCK' NOT NULL;--> statement-breakpoint
ALTER TABLE "suppliers" ADD COLUMN "dropship" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "suppliers" ADD COLUMN "submit_method" text DEFAULT 'MANUAL' NOT NULL;--> statement-breakpoint
ALTER TABLE "suppliers" ADD COLUMN "order_email" text;--> statement-breakpoint
ALTER TABLE "suppliers" ADD COLUMN "api_url" text;--> statement-breakpoint
ALTER TABLE "suppliers" ADD COLUMN "api_key" text;--> statement-breakpoint
ALTER TABLE "suppliers" ADD COLUMN "api_key_hint" text;--> statement-breakpoint
ALTER TABLE "suppliers" ADD COLUMN "signing_secret" text;--> statement-breakpoint
ALTER TABLE "suppliers" ADD COLUMN "processing_days" integer;--> statement-breakpoint
ALTER TABLE "suppliers" ADD COLUMN "dropship_rules" jsonb DEFAULT '{}'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "suppliers" ADD COLUMN "last_submit_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "suppliers" ADD COLUMN "last_submit_ok" boolean;--> statement-breakpoint
ALTER TABLE "suppliers" ADD COLUMN "last_error" text;--> statement-breakpoint
ALTER TABLE "supplier_order_items" ADD CONSTRAINT "supplier_order_items_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "supplier_order_items" ADD CONSTRAINT "supplier_order_items_supplier_order_id_supplier_orders_id_fk" FOREIGN KEY ("supplier_order_id") REFERENCES "public"."supplier_orders"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "supplier_order_items" ADD CONSTRAINT "supplier_order_items_order_item_id_order_items_id_fk" FOREIGN KEY ("order_item_id") REFERENCES "public"."order_items"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "supplier_order_items" ADD CONSTRAINT "supplier_order_items_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "supplier_order_items" ADD CONSTRAINT "supplier_order_items_variant_id_product_variants_id_fk" FOREIGN KEY ("variant_id") REFERENCES "public"."product_variants"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "supplier_order_items" ADD CONSTRAINT "supplier_order_items_offer_id_product_suppliers_id_fk" FOREIGN KEY ("offer_id") REFERENCES "public"."product_suppliers"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "supplier_orders" ADD CONSTRAINT "supplier_orders_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "supplier_orders" ADD CONSTRAINT "supplier_orders_order_id_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."orders"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "supplier_orders" ADD CONSTRAINT "supplier_orders_supplier_id_suppliers_id_fk" FOREIGN KEY ("supplier_id") REFERENCES "public"."suppliers"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "supplier_order_items_order_idx" ON "supplier_order_items" USING btree ("supplier_order_id");--> statement-breakpoint
CREATE INDEX "supplier_order_items_offer_idx" ON "supplier_order_items" USING btree ("offer_id");--> statement-breakpoint
CREATE UNIQUE INDEX "supplier_orders_org_number_key" ON "supplier_orders" USING btree ("organization_id","number");--> statement-breakpoint
CREATE UNIQUE INDEX "supplier_orders_key" ON "supplier_orders" USING btree ("idempotency_key");--> statement-breakpoint
CREATE INDEX "supplier_orders_order_idx" ON "supplier_orders" USING btree ("order_id");--> statement-breakpoint
CREATE INDEX "supplier_orders_org_status_idx" ON "supplier_orders" USING btree ("organization_id","status");