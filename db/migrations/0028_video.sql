CREATE TABLE "video_projects" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"title" text NOT NULL,
	"format" text DEFAULT 'portrait' NOT NULL,
	"transition" text DEFAULT 'fade' NOT NULL,
	"color" text DEFAULT '#111827' NOT NULL,
	"scenes" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"music_id" uuid,
	"music_volume" integer DEFAULT 35 NOT NULL,
	"voice_id" uuid,
	"status" text DEFAULT 'DRAFT' NOT NULL,
	"progress" integer DEFAULT 0 NOT NULL,
	"error" text,
	"output_id" uuid,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "video_projects" ADD CONSTRAINT "video_projects_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "video_projects" ADD CONSTRAINT "video_projects_music_id_documents_id_fk" FOREIGN KEY ("music_id") REFERENCES "public"."documents"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "video_projects" ADD CONSTRAINT "video_projects_voice_id_documents_id_fk" FOREIGN KEY ("voice_id") REFERENCES "public"."documents"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "video_projects" ADD CONSTRAINT "video_projects_output_id_documents_id_fk" FOREIGN KEY ("output_id") REFERENCES "public"."documents"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "video_projects_org_idx" ON "video_projects" USING btree ("organization_id","updated_at");