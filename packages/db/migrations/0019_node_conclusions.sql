ALTER TABLE "node_instance" ADD COLUMN "conclusion" text;--> statement-breakpoint
ALTER TABLE "node_instance" ADD COLUMN "comment" text;--> statement-breakpoint
ALTER TABLE "node_instance" ADD COLUMN "verdicts" jsonb;--> statement-breakpoint
ALTER TABLE "node_instance" ADD COLUMN "fields" jsonb;