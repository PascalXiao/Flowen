CREATE TABLE "saved_view_item" (
	"view_id" text NOT NULL,
	"work_item_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "saved_view_item_view_id_work_item_id_pk" PRIMARY KEY("view_id","work_item_id")
);
--> statement-breakpoint
CREATE TABLE "saved_view_member" (
	"view_id" text NOT NULL,
	"user_id" text NOT NULL,
	"role" text DEFAULT 'view' NOT NULL,
	CONSTRAINT "saved_view_member_view_id_user_id_pk" PRIMARY KEY("view_id","user_id")
);
--> statement-breakpoint
ALTER TABLE "saved_view" ADD COLUMN "description" text;--> statement-breakpoint
ALTER TABLE "saved_view" ADD COLUMN "kind" text DEFAULT 'condition' NOT NULL;--> statement-breakpoint
ALTER TABLE "saved_view" ADD COLUMN "visibility" text DEFAULT 'public' NOT NULL;--> statement-breakpoint
ALTER TABLE "saved_view_item" ADD CONSTRAINT "saved_view_item_view_id_saved_view_id_fk" FOREIGN KEY ("view_id") REFERENCES "public"."saved_view"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "saved_view_item" ADD CONSTRAINT "saved_view_item_work_item_id_work_item_id_fk" FOREIGN KEY ("work_item_id") REFERENCES "public"."work_item"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "saved_view_member" ADD CONSTRAINT "saved_view_member_view_id_saved_view_id_fk" FOREIGN KEY ("view_id") REFERENCES "public"."saved_view"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "saved_view_member" ADD CONSTRAINT "saved_view_member_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "saved_view_item_item" ON "saved_view_item" USING btree ("work_item_id");