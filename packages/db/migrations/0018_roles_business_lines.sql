CREATE TABLE "business_line" (
	"id" text PRIMARY KEY NOT NULL,
	"space_id" text NOT NULL,
	"name" text NOT NULL,
	"parent_id" text,
	"admins" jsonb,
	"disabled" boolean DEFAULT false NOT NULL,
	"sort" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "role_def" ADD COLUMN "config" jsonb;--> statement-breakpoint
ALTER TABLE "role_def" ADD COLUMN "sort" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "work_item" ADD COLUMN "role_overrides" jsonb;--> statement-breakpoint
ALTER TABLE "business_line" ADD CONSTRAINT "business_line_space_id_space_id_fk" FOREIGN KEY ("space_id") REFERENCES "public"."space"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "business_line_space" ON "business_line" USING btree ("space_id");