CREATE TABLE "geo_places" (
	"key" text PRIMARY KEY NOT NULL,
	"found" boolean NOT NULL,
	"lat" double precision,
	"lng" double precision,
	"label" text,
	"checked_at" timestamp with time zone DEFAULT now() NOT NULL
);
