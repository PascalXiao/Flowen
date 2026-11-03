ALTER TABLE "attachment" ADD COLUMN "field_key" text;--> statement-breakpoint
ALTER TABLE "field_def" ADD COLUMN "config" jsonb;