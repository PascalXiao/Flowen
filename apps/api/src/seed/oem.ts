import { type Db, schema } from "@fp/db";
import { oemV289 } from "@fp/engine";

/** 选项类开关字段的取值。 */
const yesNo = [
  { value: "是", label: "是" },
  { value: "否", label: "否" },
];

/**
 * 把 OEM v289 导入一个空间：工作项类型「项目」、流程用到的字段和角色、已发布的流程模板。
 * 字段键直接用模板里的字段名，和引擎样例里的条件一致。返回新建的类型 id 和模板 id。
 */
export async function importOemTemplate(db: Db, spaceId: string): Promise<{ typeId: string; templateId: string }> {
  const { oemFlow, F } = oemV289;
  const typeId = `${spaceId}/project`;
  const templateId = `${typeId}/oem`;
  const versionId = `${templateId}/v${oemFlow.version}`;

  await db.transaction(async (tx) => {
    await tx
      .insert(schema.workItemType)
      .values({ id: typeId, spaceId, key: "project", name: "项目", flowMode: "node" });

    await tx.insert(schema.fieldDef).values(
      Object.values(F).map((key, sort) => ({
        id: `${typeId}/field/${key}`,
        typeId,
        key,
        name: key,
        // 关联 SKU 先按文本记录 SKU 编号
        dataType: key === F.linkedSku || key === F.formulaLocked ? ("text" as const) : ("select" as const),
        options: key === F.linkedSku || key === F.formulaLocked ? null : yesNo,
        sort,
      })),
    );

    const roles = [...new Set(oemFlow.nodes.flatMap((n) => n.ownerRoles))];
    await tx
      .insert(schema.roleDef)
      .values(roles.map((key) => ({ id: `${typeId}/role/${key}`, typeId, key, name: key })));

    await tx
      .insert(schema.flowTemplate)
      .values({ id: templateId, typeId, key: oemFlow.key, name: "OEM", currentVersionId: versionId });
    await tx.insert(schema.flowVersion).values({
      id: versionId,
      templateId,
      version: oemFlow.version,
      definition: oemFlow,
      publishedAt: new Date(),
    });
  });

  return { typeId, templateId };
}
