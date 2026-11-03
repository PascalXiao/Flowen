CREATE TABLE "type_access" (
	"type_id" text NOT NULL,
	"user_id" text NOT NULL,
	"level" text NOT NULL,
	CONSTRAINT "type_access_type_id_user_id_pk" PRIMARY KEY("type_id","user_id")
);
--> statement-breakpoint
CREATE TABLE "user_group" (
	"id" text PRIMARY KEY NOT NULL,
	"space_id" text NOT NULL,
	"name" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "user_group_member" (
	"group_id" text NOT NULL,
	"user_id" text NOT NULL,
	CONSTRAINT "user_group_member_group_id_user_id_pk" PRIMARY KEY("group_id","user_id")
);
--> statement-breakpoint
ALTER TABLE "work_item_type" ADD COLUMN "permissions" jsonb;--> statement-breakpoint
ALTER TABLE "work_item_type" ADD COLUMN "view_base" text DEFAULT 'all' NOT NULL;--> statement-breakpoint
ALTER TABLE "type_access" ADD CONSTRAINT "type_access_type_id_work_item_type_id_fk" FOREIGN KEY ("type_id") REFERENCES "public"."work_item_type"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "type_access" ADD CONSTRAINT "type_access_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_group" ADD CONSTRAINT "user_group_space_id_space_id_fk" FOREIGN KEY ("space_id") REFERENCES "public"."space"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_group_member" ADD CONSTRAINT "user_group_member_group_id_user_group_id_fk" FOREIGN KEY ("group_id") REFERENCES "public"."user_group"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_group_member" ADD CONSTRAINT "user_group_member_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;