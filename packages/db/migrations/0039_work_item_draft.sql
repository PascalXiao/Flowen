CREATE TABLE "work_item_draft" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"type_id" text NOT NULL,
	"name" text DEFAULT '' NOT NULL,
	"data" jsonb NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "work_item_draft" ADD CONSTRAINT "work_item_draft_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "work_item_draft" ADD CONSTRAINT "work_item_draft_type_id_work_item_type_id_fk" FOREIGN KEY ("type_id") REFERENCES "public"."work_item_type"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "work_item_draft_user" ON "work_item_draft" USING btree ("user_id","type_id","updated_at");