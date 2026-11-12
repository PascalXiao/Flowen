CREATE TABLE "link_rule" (
	"id" text PRIMARY KEY NOT NULL,
	"space_id" text NOT NULL,
	"name" text NOT NULL,
	"relation_def_id" text NOT NULL,
	"source_side" text NOT NULL,
	"config" jsonb NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"created_by" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "link_rule" ADD CONSTRAINT "link_rule_space_id_space_id_fk" FOREIGN KEY ("space_id") REFERENCES "public"."space"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "link_rule" ADD CONSTRAINT "link_rule_relation_def_id_relation_def_id_fk" FOREIGN KEY ("relation_def_id") REFERENCES "public"."relation_def"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "link_rule" ADD CONSTRAINT "link_rule_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "link_rule_space" ON "link_rule" USING btree ("space_id");--> statement-breakpoint
CREATE INDEX "link_rule_relation" ON "link_rule" USING btree ("relation_def_id");