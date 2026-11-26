CREATE TABLE "automation_request" (
	"id" text PRIMARY KEY NOT NULL,
	"rule_id" text NOT NULL,
	"event_id" bigint NOT NULL,
	"work_item_id" text,
	"url" text NOT NULL,
	"headers" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"body" text NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"response_status" integer,
	"response_body" text,
	"error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"finished_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "automation_request" ADD CONSTRAINT "automation_request_rule_id_automation_rule_id_fk" FOREIGN KEY ("rule_id") REFERENCES "public"."automation_rule"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "automation_request" ADD CONSTRAINT "automation_request_event_id_event_log_id_fk" FOREIGN KEY ("event_id") REFERENCES "public"."event_log"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "automation_request" ADD CONSTRAINT "automation_request_work_item_id_work_item_id_fk" FOREIGN KEY ("work_item_id") REFERENCES "public"."work_item"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "automation_request_rule" ON "automation_request" USING btree ("rule_id","created_at");--> statement-breakpoint
CREATE INDEX "automation_request_event" ON "automation_request" USING btree ("event_id");