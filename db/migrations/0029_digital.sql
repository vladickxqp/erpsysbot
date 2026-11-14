CREATE TABLE "digital_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"product_id" uuid NOT NULL,
	"variant_id" uuid,
	"content" text NOT NULL,
	"status" text DEFAULT 'AVAILABLE' NOT NULL,
	"order_id" uuid,
	"order_item_id" uuid,
	"sold_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "products" ADD COLUMN "digital_shared" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "products" ADD COLUMN "digital_note" text;--> statement-breakpoint
ALTER TABLE "digital_items" ADD CONSTRAINT "digital_items_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "digital_items" ADD CONSTRAINT "digital_items_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "digital_items" ADD CONSTRAINT "digital_items_variant_id_product_variants_id_fk" FOREIGN KEY ("variant_id") REFERENCES "public"."product_variants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "digital_items" ADD CONSTRAINT "digital_items_order_id_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."orders"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "digital_items_pool_idx" ON "digital_items" USING btree ("organization_id","product_id","status");--> statement-breakpoint
CREATE INDEX "digital_items_order_idx" ON "digital_items" USING btree ("order_id");