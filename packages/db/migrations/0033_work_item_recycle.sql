ALTER TABLE "event_log" DROP CONSTRAINT "event_log_work_item_id_work_item_id_fk";
--> statement-breakpoint
ALTER TABLE "work_item" ADD COLUMN "deleted_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "work_item" ADD COLUMN "deleted_by" text;--> statement-breakpoint
ALTER TABLE "event_log" ADD CONSTRAINT "event_log_work_item_id_work_item_id_fk" FOREIGN KEY ("work_item_id") REFERENCES "public"."work_item"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "work_item" ADD CONSTRAINT "work_item_deleted_by_user_id_fk" FOREIGN KEY ("deleted_by") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "work_item_deleted" ON "work_item" USING btree ("space_id","deleted_at");