ALTER TABLE "attachment" ADD COLUMN "comment_id" text;--> statement-breakpoint
ALTER TABLE "comment" ADD COLUMN "field_key" text;--> statement-breakpoint
ALTER TABLE "comment" ADD COLUMN "quote" text;--> statement-breakpoint
-- 评论正文改成富文本：原来的纯文本转义后包进段落，换行变成 <br>
UPDATE "comment" SET "body" = '<p>' || replace(replace(replace(replace("body", '&', '&amp;'), '<', '&lt;'), '>', '&gt;'), E'\n', '<br>') || '</p>' WHERE "body" <> '';
