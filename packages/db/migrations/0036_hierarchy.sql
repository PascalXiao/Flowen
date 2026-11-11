CREATE TABLE "hierarchy" (
	"id" text PRIMARY KEY NOT NULL,
	"space_id" text NOT NULL,
	"name" text NOT NULL,
	"root_type_id" text NOT NULL,
	"layers" jsonb NOT NULL,
	"created_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "hierarchy" ADD CONSTRAINT "hierarchy_space_id_space_id_fk" FOREIGN KEY ("space_id") REFERENCES "public"."space"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "hierarchy" ADD CONSTRAINT "hierarchy_root_type_id_work_item_type_id_fk" FOREIGN KEY ("root_type_id") REFERENCES "public"."work_item_type"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "hierarchy" ADD CONSTRAINT "hierarchy_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "hierarchy_space" ON "hierarchy" USING btree ("space_id");