CREATE TABLE "movie_parts" (
	"movie_id" uuid,
	"part" integer,
	"size" integer NOT NULL,
	"hash" text NOT NULL,
	CONSTRAINT "movie_parts_pkey" PRIMARY KEY("movie_id","part")
);
--> statement-breakpoint
CREATE TABLE "movies" (
	"id" uuid PRIMARY KEY,
	"titulo" text NOT NULL,
	"ano" integer NOT NULL,
	"genero" text NOT NULL,
	"descricao" text NOT NULL,
	"filename" text NOT NULL,
	"size" bigint NOT NULL,
	"content_type" text NOT NULL,
	"cover_type" text,
	"scope" text NOT NULL,
	"status" text DEFAULT 'uploading' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX "movies_catalog_idx" ON "movies" ("scope","status","created_at");--> statement-breakpoint
ALTER TABLE "movie_parts" ADD CONSTRAINT "movie_parts_movie_id_movies_id_fkey" FOREIGN KEY ("movie_id") REFERENCES "movies"("id") ON DELETE CASCADE;