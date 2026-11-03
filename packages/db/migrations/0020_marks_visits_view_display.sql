CREATE TABLE "work_item_mark" (
	"work_item_id" text NOT NULL,
	"user_id" text NOT NULL,
	"kind" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "work_item_mark_work_item_id_user_id_kind_pk" PRIMARY KEY("work_item_id","user_id","kind")
);
--> statement-breakpoint
CREATE TABLE "work_item_visit" (
	"work_item_id" text NOT NULL,
	"user_id" text NOT NULL,
	"visited_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "work_item_visit_work_item_id_user_id_pk" PRIMARY KEY("work_item_id","user_id")
);
--> statement-breakpoint
ALTER TABLE "saved_view" ADD COLUMN "display" jsonb;--> statement-breakpoint
ALTER TABLE "work_item_mark" ADD CONSTRAINT "work_item_mark_work_item_id_work_item_id_fk" FOREIGN KEY ("work_item_id") REFERENCES "public"."work_item"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "work_item_mark" ADD CONSTRAINT "work_item_mark_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "work_item_visit" ADD CONSTRAINT "work_item_visit_work_item_id_work_item_id_fk" FOREIGN KEY ("work_item_id") REFERENCES "public"."work_item"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "work_item_visit" ADD CONSTRAINT "work_item_visit_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "work_item_mark_user" ON "work_item_mark" USING btree ("user_id","kind");--> statement-breakpoint
CREATE INDEX "work_item_visit_user" ON "work_item_visit" USING btree ("user_id","visited_at");