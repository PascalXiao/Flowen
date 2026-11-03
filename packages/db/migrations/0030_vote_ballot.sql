CREATE TABLE "vote_ballot" (
	"work_item_id" text NOT NULL,
	"field_key" text NOT NULL,
	"user_id" text NOT NULL,
	"choices" jsonb NOT NULL,
	"remark" text,
	"revealed" boolean DEFAULT true NOT NULL,
	"voted_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "vote_ballot_work_item_id_field_key_user_id_pk" PRIMARY KEY("work_item_id","field_key","user_id")
);
--> statement-breakpoint
ALTER TABLE "vote_ballot" ADD CONSTRAINT "vote_ballot_work_item_id_work_item_id_fk" FOREIGN KEY ("work_item_id") REFERENCES "public"."work_item"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "vote_ballot" ADD CONSTRAINT "vote_ballot_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;