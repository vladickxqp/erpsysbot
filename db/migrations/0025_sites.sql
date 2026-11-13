ALTER TABLE "stores" ADD COLUMN "kind" text DEFAULT 'store' NOT NULL;--> statement-breakpoint
ALTER TABLE "stores" ADD COLUMN "custom_pages" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "stores" ADD COLUMN "live" jsonb;
--> statement-breakpoint
-- Published sites keep what visitors see now; edits from here on wait until they are published.
UPDATE "stores" SET "live" = jsonb_build_object('design', "design", 'blocks', "blocks", 'customPages', "custom_pages", 'pages', "pages") WHERE "status" = 'PUBLISHED';
