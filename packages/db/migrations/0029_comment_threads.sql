ALTER TABLE "comment" ADD COLUMN "parent_id" text;--> statement-breakpoint
ALTER TABLE "comment" ADD COLUMN "reply_to_id" text;--> statement-breakpoint
ALTER TABLE "comment" ADD COLUMN "edited_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "comment" ADD COLUMN "deleted_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "comment" ADD CONSTRAINT "comment_reply_to_id_user_id_fk" FOREIGN KEY ("reply_to_id") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;