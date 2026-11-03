CREATE TABLE "automation_fire" (
	"rule_id" text NOT NULL,
	"work_item_id" text NOT NULL,
	"slot" bigint NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "automation_fire_rule_id_work_item_id_slot_pk" PRIMARY KEY("rule_id","work_item_id","slot")
);
--> statement-breakpoint
ALTER TABLE "automation_rule" ADD COLUMN "branches" jsonb;--> statement-breakpoint
ALTER TABLE "automation_fire" ADD CONSTRAINT "automation_fire_rule_id_automation_rule_id_fk" FOREIGN KEY ("rule_id") REFERENCES "public"."automation_rule"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "automation_fire" ADD CONSTRAINT "automation_fire_work_item_id_work_item_id_fk" FOREIGN KEY ("work_item_id") REFERENCES "public"."work_item"("id") ON DELETE cascade ON UPDATE no action;