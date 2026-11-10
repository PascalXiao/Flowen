CREATE TABLE "plan_baseline" (
	"id" text PRIMARY KEY NOT NULL,
	"work_item_id" text NOT NULL,
	"name" text NOT NULL,
	"nodes" jsonb NOT NULL,
	"created_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "plan_baseline" ADD CONSTRAINT "plan_baseline_work_item_id_work_item_id_fk" FOREIGN KEY ("work_item_id") REFERENCES "public"."work_item"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "plan_baseline" ADD CONSTRAINT "plan_baseline_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "plan_baseline_work_item" ON "plan_baseline" USING btree ("work_item_id");