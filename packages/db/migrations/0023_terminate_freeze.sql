ALTER TABLE "work_item" ADD COLUMN "terminate_reason" text;--> statement-breakpoint
ALTER TABLE "work_item" ADD COLUMN "frozen" boolean DEFAULT false NOT NULL;