CREATE TABLE "infra"."audit_log" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "infra"."audit_log_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"at" timestamp with time zone DEFAULT now() NOT NULL,
	"actor" text,
	"space_id" text,
	"category" text NOT NULL,
	"action" text NOT NULL,
	"target_id" text,
	"target_name" text,
	"detail" jsonb,
	"ip" text
);
--> statement-breakpoint
CREATE TABLE "org_admin" (
	"user_id" text PRIMARY KEY NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "space_template" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"scope" text DEFAULT 'personal' NOT NULL,
	"source_space_id" text,
	"includes" jsonb NOT NULL,
	"summary" jsonb NOT NULL,
	"created_by" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "infra"."space_template_data" (
	"template_id" text PRIMARY KEY NOT NULL,
	"snapshot" jsonb NOT NULL
);
--> statement-breakpoint
CREATE TABLE "team" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"parent_ids" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"admins" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"space_ids" jsonb,
	"sort" integer DEFAULT 0 NOT NULL,
	"created_by" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "team_member" (
	"team_id" text NOT NULL,
	"user_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "team_member_team_id_user_id_pk" PRIMARY KEY("team_id","user_id")
);
--> statement-breakpoint
ALTER TABLE "org_admin" ADD CONSTRAINT "org_admin_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "space_template" ADD CONSTRAINT "space_template_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "infra"."space_template_data" ADD CONSTRAINT "space_template_data_template_id_space_template_id_fk" FOREIGN KEY ("template_id") REFERENCES "public"."space_template"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "team" ADD CONSTRAINT "team_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "team_member" ADD CONSTRAINT "team_member_team_id_team_id_fk" FOREIGN KEY ("team_id") REFERENCES "public"."team"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "team_member" ADD CONSTRAINT "team_member_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "audit_log_at" ON "infra"."audit_log" USING btree ("at");--> statement-breakpoint
CREATE INDEX "audit_log_space" ON "infra"."audit_log" USING btree ("space_id","at");--> statement-breakpoint
CREATE INDEX "audit_log_actor" ON "infra"."audit_log" USING btree ("actor","at");--> statement-breakpoint
CREATE INDEX "team_member_user" ON "team_member" USING btree ("user_id");--> statement-breakpoint
-- 已有部署：最早注册的人成为企业管理员
INSERT INTO "org_admin" ("user_id") SELECT "id" FROM "user" ORDER BY "created_at" LIMIT 1;
