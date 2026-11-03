import { randomUUID } from "node:crypto";
import { appendEvents, type Database, schema } from "@fp/db";
import { and, eq } from "drizzle-orm";
import { Hono } from "hono";
import { bodyLimit } from "hono/body-limit";
import type { BlobStore } from "./blobs.ts";

/** 单个附件的大小上限。 */
export const MAX_ATTACHMENT_BYTES = 50 * 1024 * 1024;

/** 浏览器里可以直接打开预览的类型；其余一律按下载处理（SVG、HTML 可能带脚本，不内联）。 */
const INLINE = /^(image\/(png|jpeg|gif|webp)|application\/pdf|text\/plain)$/;

/** 文件名用 RFC 6266 的 filename*（UTF-8），再给不认识它的客户端一个 ASCII 的 filename。 */
function contentDisposition(kind: "inline" | "attachment", name: string) {
  const ascii = name.replace(/[^\x20-\x7e]|["\\]/g, "_");
  return `${kind}; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(name)}`;
}

/**
 * 附件的上传、下载、删除。文件走 HTTP（Zero 不适合传二进制），元数据写进 attachment 表，
 * 由 Zero 同步给前端；上传、删除同时记事件，进工作项动态。
 */
export function attachmentRoutes(
  database: Database,
  blobs: BlobStore,
  userID: (headers: Headers) => Promise<string | null>,
) {
  /** 工作项所在空间里自己的角色；不是成员时为 null。 */
  async function roleOn(workItemId: string, userId: string) {
    const [row] = await database.db
      .select({ spaceId: schema.workItem.spaceId, typeId: schema.workItem.typeId, role: schema.spaceMember.role })
      .from(schema.workItem)
      .innerJoin(
        schema.spaceMember,
        and(eq(schema.spaceMember.spaceId, schema.workItem.spaceId), eq(schema.spaceMember.userId, userId)),
      )
      .where(eq(schema.workItem.id, workItemId));
    return row ?? null;
  }

  return new Hono()
    .post(
      "/api/work-items/:id/attachments",
      bodyLimit({
        maxSize: MAX_ATTACHMENT_BYTES + 64 * 1024,
        onError: (c) => c.json({ error: "文件不能超过 50 MB。" }, 413),
      }),
      async (c) => {
        const me = await userID(c.req.raw.headers);
        if (!me) return c.json({ error: "未登录。" }, 401);
        const workItemId = c.req.param("id");
        const member = await roleOn(workItemId, me);
        if (!member) return c.json({ error: "工作项不存在或没有权限。" }, 404);
        if (member.role === "guest") return c.json({ error: "访客只能查看和评论。" }, 403);
        // ?field= 表示传到附件字段里：只记上字段键，放不放进字段值由前端随后改字段值决定
        const fieldKey = c.req.query("field") || null;
        if (fieldKey) {
          const [def] = await database.db
            .select({ dataType: schema.fieldDef.dataType })
            .from(schema.fieldDef)
            .where(and(eq(schema.fieldDef.typeId, member.typeId), eq(schema.fieldDef.key, fieldKey)));
          if (def?.dataType !== "attachment") return c.json({ error: "附件字段不存在。" }, 400);
        }
        const body = await c.req.parseBody();
        const file = body.file;
        if (!(file instanceof File) || !file.name) return c.json({ error: "请选择文件。" }, 400);
        if (file.size > MAX_ATTACHMENT_BYTES) return c.json({ error: "文件不能超过 50 MB。" }, 413);

        const id = randomUUID();
        const storageKey = `attachments/${id}`;
        const size = await blobs.put(storageKey, file.stream());
        const row = {
          id,
          workItemId,
          name: file.name.slice(0, 255),
          contentType: file.type || "application/octet-stream",
          size,
          storageKey,
          fieldKey,
          uploadedBy: me,
        };
        try {
          await database.db.transaction(async (tx) => {
            await tx.insert(schema.attachment).values(row);
            await appendEvents(tx, [
              {
                spaceId: member.spaceId,
                workItemId,
                kind: "attachmentAdded",
                payload: { attachmentId: id, name: row.name },
                actor: me,
              },
            ]);
          });
        } catch (error) {
          await blobs.delete(storageKey);
          throw error;
        }
        return c.json({ id, name: row.name, size, contentType: row.contentType });
      },
    )
    .get("/api/attachments/:id", async (c) => {
      const me = await userID(c.req.raw.headers);
      if (!me) return c.json({ error: "未登录。" }, 401);
      const [file] = await database.db
        .select()
        .from(schema.attachment)
        .where(eq(schema.attachment.id, c.req.param("id")));
      if (!file || !(await roleOn(file.workItemId, me))) return c.json({ error: "附件不存在或没有权限。" }, 404);
      const blob = await blobs.get(file.storageKey);
      if (!blob) return c.json({ error: "附件文件丢失了。" }, 410);
      const inline = c.req.query("inline") !== undefined && INLINE.test(file.contentType);
      return new Response(blob.body, {
        headers: {
          "content-type": inline ? file.contentType : "application/octet-stream",
          "content-length": String(blob.size),
          "content-disposition": contentDisposition(inline ? "inline" : "attachment", file.name),
          "x-content-type-options": "nosniff",
          // 内联打开的文件放进沙箱，即便内容里藏了脚本也跑不起来（下载时不加，否则浏览器会忽略文件名）
          ...(inline && { "content-security-policy": "sandbox" }),
          "cache-control": "private, max-age=3600",
        },
      });
    })
    .delete("/api/attachments/:id", async (c) => {
      const me = await userID(c.req.raw.headers);
      if (!me) return c.json({ error: "未登录。" }, 401);
      const [file] = await database.db
        .select()
        .from(schema.attachment)
        .where(eq(schema.attachment.id, c.req.param("id")));
      const member = file && (await roleOn(file.workItemId, me));
      if (!file || !member) return c.json({ error: "附件不存在或没有权限。" }, 404);
      if (member.role !== "admin" && file.uploadedBy !== me)
        return c.json({ error: "只有上传人和空间管理员可以删除附件。" }, 403);
      await database.db.transaction(async (tx) => {
        await tx.delete(schema.attachment).where(eq(schema.attachment.id, file.id));
        await appendEvents(tx, [
          {
            spaceId: member.spaceId,
            workItemId: file.workItemId,
            kind: "attachmentRemoved",
            payload: { attachmentId: file.id, name: file.name },
            actor: me,
          },
        ]);
      });
      // 记录删掉之后再删文件：事务失败时文件还在
      await blobs.delete(file.storageKey);
      return c.json({ ok: true });
    });
}
