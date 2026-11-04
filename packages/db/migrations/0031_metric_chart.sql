CREATE TABLE "metric_chart" (
	"id" text PRIMARY KEY NOT NULL,
	"space_id" text NOT NULL,
	"name" text NOT NULL,
	"filter" jsonb NOT NULL,
	"config" jsonb NOT NULL,
	"sort" integer DEFAULT 0 NOT NULL,
	"created_by" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "metric_chart" ADD CONSTRAINT "metric_chart_space_id_space_id_fk" FOREIGN KEY ("space_id") REFERENCES "public"."space"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "metric_chart" ADD CONSTRAINT "metric_chart_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;