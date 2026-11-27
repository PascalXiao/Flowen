import type { Transaction } from "@rocicorp/zero";
import { z } from "zod";
import { zql } from "./schema.gen.ts";
import { isOrgAdmin } from "./teams.ts";

/*
 * 空间模板（模板中心）的改名、改说明、发布范围和删除。
 * 新建模板要在服务端给空间拍快照，走接口（apps/api 的 /api/space-templates）。
 */

export const TEMPLATE_SCOPE_LABEL = { personal: "个人模板", org: "企业模板" } as const;

export const updateSpaceTemplateArgs = z.object({
  id: z.string(),
  name: z.string().trim().min(1).max(60),
  description: z.string().trim().max(500).nullable(),
  scope: z.enum(["personal", "org"]),
});
export const deleteSpaceTemplateArgs = z.object({ id: z.string() });

/** 创建人和企业管理员能改；设成企业模板要企业管理员。 */
async function requireTemplateOwner(tx: Transaction, id: string, userID: string) {
  const template = await tx.run(zql.spaceTemplate.where("id", id).one());
  if (!template) throw new Error("模板不存在。");
  const orgAdmin = await isOrgAdmin(tx, userID);
  if (template.createdBy !== userID && !orgAdmin) throw new Error("只有模板的创建人和企业管理员可以修改模板。");
  return { template, orgAdmin };
}

export async function updateSpaceTemplate(
  tx: Transaction,
  args: z.output<typeof updateSpaceTemplateArgs>,
  userID: string,
) {
  const { template, orgAdmin } = await requireTemplateOwner(tx, args.id, userID);
  if (args.scope !== template.scope && !orgAdmin) throw new Error("只有企业管理员可以发布或撤下企业模板。");
  await tx.mutate.spaceTemplate.update({
    id: args.id,
    name: args.name,
    description: args.description,
    scope: args.scope,
    updatedAt: Date.now(),
  });
}

export async function deleteSpaceTemplate(
  tx: Transaction,
  args: z.output<typeof deleteSpaceTemplateArgs>,
  userID: string,
) {
  await requireTemplateOwner(tx, args.id, userID);
  await tx.mutate.spaceTemplate.delete({ id: args.id });
}
