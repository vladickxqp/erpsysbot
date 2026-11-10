CREATE TABLE "product_categories" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"name" text NOT NULL,
	"parent_id" uuid,
	"position" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "product_images" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"product_id" uuid NOT NULL,
	"document_id" uuid NOT NULL,
	"position" integer DEFAULT 0 NOT NULL,
	"alt" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "product_imports" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"file_name" text NOT NULL,
	"status" text DEFAULT 'PREVIEW' NOT NULL,
	"header" jsonb NOT NULL,
	"rows" jsonb NOT NULL,
	"mapping" jsonb NOT NULL,
	"created_count" integer DEFAULT 0 NOT NULL,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"applied_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "product_suppliers" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"product_id" uuid NOT NULL,
	"variant_id" uuid,
	"supplier_id" uuid NOT NULL,
	"supplier_sku" text,
	"purchase_price_cents" integer NOT NULL,
	"currency" text NOT NULL,
	"min_order_qty" numeric(12, 3),
	"lead_time_days" integer,
	"shipping_cost_cents" integer,
	"preferred" boolean DEFAULT false NOT NULL,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "product_variants" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"product_id" uuid NOT NULL,
	"options" jsonb NOT NULL,
	"options_key" text NOT NULL,
	"sku" text,
	"barcode" text,
	"price_cents" integer,
	"purchase_price_cents" integer,
	"stock_quantity" numeric(12, 3) DEFAULT '0' NOT NULL,
	"min_stock" numeric(12, 3),
	"active" boolean DEFAULT true NOT NULL,
	"position" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "supplier_price_history" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"product_supplier_id" uuid NOT NULL,
	"purchase_price_cents" integer NOT NULL,
	"currency" text NOT NULL,
	"recorded_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "organizations" ADD COLUMN "payment_fee_percent" numeric(5, 2) DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "organizations" ADD COLUMN "payment_fee_fixed_cents" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "products" ADD COLUMN "category_id" uuid;--> statement-breakpoint
ALTER TABLE "products" ADD COLUMN "weight_grams" integer;--> statement-breakpoint
ALTER TABLE "products" ADD COLUMN "length_mm" integer;--> statement-breakpoint
ALTER TABLE "products" ADD COLUMN "width_mm" integer;--> statement-breakpoint
ALTER TABLE "products" ADD COLUMN "height_mm" integer;--> statement-breakpoint
ALTER TABLE "products" ADD COLUMN "attributes" jsonb DEFAULT '{}'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "products" ADD COLUMN "variant_options" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "products" ADD COLUMN "shipping_cost_cents" integer;--> statement-breakpoint
ALTER TABLE "products" ADD COLUMN "other_cost_cents" integer;--> statement-breakpoint
ALTER TABLE "products" ADD COLUMN "returnable" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "products" ADD COLUMN "return_days" integer;--> statement-breakpoint
ALTER TABLE "products" ADD COLUMN "shipping_note" text;--> statement-breakpoint
ALTER TABLE "products" ADD COLUMN "import_id" uuid;--> statement-breakpoint
ALTER TABLE "stock_movements" ADD COLUMN "variant_id" uuid;--> statement-breakpoint
ALTER TABLE "suppliers" ADD COLUMN "website" text;--> statement-breakpoint
ALTER TABLE "suppliers" ADD COLUMN "currency" text;--> statement-breakpoint
ALTER TABLE "suppliers" ADD COLUMN "payment_terms_days" integer;--> statement-breakpoint
ALTER TABLE "suppliers" ADD COLUMN "shipping_terms" text;--> statement-breakpoint
ALTER TABLE "suppliers" ADD COLUMN "delivery_days" integer;--> statement-breakpoint
ALTER TABLE "suppliers" ADD COLUMN "return_conditions" text;--> statement-breakpoint
ALTER TABLE "suppliers" ADD COLUMN "status" text DEFAULT 'ACTIVE' NOT NULL;--> statement-breakpoint
ALTER TABLE "product_categories" ADD CONSTRAINT "product_categories_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "product_images" ADD CONSTRAINT "product_images_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "product_images" ADD CONSTRAINT "product_images_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "product_images" ADD CONSTRAINT "product_images_document_id_documents_id_fk" FOREIGN KEY ("document_id") REFERENCES "public"."documents"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "product_imports" ADD CONSTRAINT "product_imports_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "product_suppliers" ADD CONSTRAINT "product_suppliers_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "product_suppliers" ADD CONSTRAINT "product_suppliers_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "product_suppliers" ADD CONSTRAINT "product_suppliers_variant_id_product_variants_id_fk" FOREIGN KEY ("variant_id") REFERENCES "public"."product_variants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "product_suppliers" ADD CONSTRAINT "product_suppliers_supplier_id_suppliers_id_fk" FOREIGN KEY ("supplier_id") REFERENCES "public"."suppliers"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "product_variants" ADD CONSTRAINT "product_variants_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "product_variants" ADD CONSTRAINT "product_variants_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "supplier_price_history" ADD CONSTRAINT "supplier_price_history_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "supplier_price_history" ADD CONSTRAINT "supplier_price_history_product_supplier_id_product_suppliers_id_fk" FOREIGN KEY ("product_supplier_id") REFERENCES "public"."product_suppliers"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "product_categories_org_parent_name_key" ON "product_categories" USING btree ("organization_id",coalesce("parent_id", '00000000-0000-0000-0000-000000000000'::uuid),lower("name"));--> statement-breakpoint
CREATE UNIQUE INDEX "product_images_product_document_key" ON "product_images" USING btree ("product_id","document_id");--> statement-breakpoint
CREATE INDEX "product_imports_org_created_idx" ON "product_imports" USING btree ("organization_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "product_suppliers_offer_key" ON "product_suppliers" USING btree ("product_id",coalesce("variant_id", '00000000-0000-0000-0000-000000000000'::uuid),"supplier_id");--> statement-breakpoint
CREATE INDEX "product_suppliers_supplier_idx" ON "product_suppliers" USING btree ("supplier_id");--> statement-breakpoint
CREATE UNIQUE INDEX "product_variants_product_options_key" ON "product_variants" USING btree ("product_id","options_key");--> statement-breakpoint
CREATE UNIQUE INDEX "product_variants_org_sku_key" ON "product_variants" USING btree ("organization_id","sku");--> statement-breakpoint
CREATE INDEX "supplier_price_history_offer_idx" ON "supplier_price_history" USING btree ("product_supplier_id","recorded_at");--> statement-breakpoint
ALTER TABLE "products" ADD CONSTRAINT "products_category_id_product_categories_id_fk" FOREIGN KEY ("category_id") REFERENCES "public"."product_categories"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_movements" ADD CONSTRAINT "stock_movements_variant_id_product_variants_id_fk" FOREIGN KEY ("variant_id") REFERENCES "public"."product_variants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "products_org_category_idx" ON "products" USING btree ("organization_id","category_id");--> statement-breakpoint
INSERT INTO "product_categories" ("organization_id", "name") SELECT DISTINCT "organization_id", trim("category") FROM "products" WHERE "category" IS NOT NULL AND trim("category") <> '' ON CONFLICT DO NOTHING;--> statement-breakpoint
UPDATE "products" p SET "category_id" = c."id" FROM "product_categories" c WHERE c."organization_id" = p."organization_id" AND c."parent_id" IS NULL AND lower(c."name") = lower(trim(p."category"));
