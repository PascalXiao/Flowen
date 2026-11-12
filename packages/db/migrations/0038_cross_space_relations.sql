ALTER TABLE "relation_def" ADD COLUMN "to_space_id" text;--> statement-breakpoint
UPDATE "relation_def" d SET "to_space_id" = t."space_id" FROM "work_item_type" t WHERE t."id" = d."to_type_id";--> statement-breakpoint
ALTER TABLE "relation_def" ALTER COLUMN "to_space_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "relation_def" ADD CONSTRAINT "relation_def_to_space_id_space_id_fk" FOREIGN KEY ("to_space_id") REFERENCES "public"."space"("id") ON DELETE no action ON UPDATE no action;
