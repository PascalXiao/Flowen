CREATE TABLE "node_dependency" (
	"id" text PRIMARY KEY NOT NULL,
	"work_item_id" text NOT NULL,
	"node_key" text NOT NULL,
	"target_node_id" text NOT NULL,
	"target_node_name" text NOT NULL,
	"allow" text NOT NULL,
	"created_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "node_dependency" ADD CONSTRAINT "node_dependency_work_item_id_work_item_id_fk" FOREIGN KEY ("work_item_id") REFERENCES "public"."work_item"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "node_dependency" ADD CONSTRAINT "node_dependency_target_node_id_node_instance_id_fk" FOREIGN KEY ("target_node_id") REFERENCES "public"."node_instance"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "node_dependency" ADD CONSTRAINT "node_dependency_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "node_dependency_unique" ON "node_dependency" USING btree ("work_item_id","node_key","target_node_id","allow");--> statement-breakpoint
CREATE INDEX "node_dependency_target" ON "node_dependency" USING btree ("target_node_id");