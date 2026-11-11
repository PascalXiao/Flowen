import { randomUUID } from "node:crypto";
import { connect, schema } from "@fp/db";
import { demoSample } from "@fp/engine";
import { createMutatorRunner } from "@fp/server";
import { eq } from "drizzle-orm";
import { config } from "../config.ts";
import { importDemoTemplate } from "./demo.ts";

/**
 * 压测数据：给一个已注册的用户建一个空间，导入示例流程，再加一批字段，按流程新建很多工作项并填满字段。
 * 工作项走和界面一样的 mutator（算节点、写事件），字段值在新建时一起写。
 *
 * 用法：pnpm --filter @fp/api seed:load <邮箱> [工作项数，默认 1000] [额外字段数，默认 150]
 */
const [email, countArg = "1000", fieldsArg = "150"] = process.argv.slice(2);
if (!email) {
  console.error("用法：pnpm --filter @fp/api seed:load <邮箱> [工作项数] [额外字段数]");
  process.exit(1);
}
const count = Number(countArg);
const extraFields = Number(fieldsArg);

const database = connect(config.databaseUrl);
const runner = createMutatorRunner(database);
try {
  const [user] = await database.db.select().from(schema.user).where(eq(schema.user.email, email.toLowerCase()));
  if (!user) throw new Error(`没有用 ${email} 注册的用户。`);

  const spaceId = randomUUID();
  await runner.run("space.create", { id: spaceId, name: `压测 ${count}` }, { userID: user.id });
  const { typeId } = await importDemoTemplate(database.db, spaceId);

  // 额外字段：文本、单选、数字、日期轮流，接近一个字段很多的真实类型
  const kinds = ["text", "select", "number", "date"] as const;
  const options = ["高", "中", "低"].map((v) => ({ value: v, label: v }));
  const fields = Array.from({ length: extraFields }, (_, i) => {
    const dataType = kinds[i % kinds.length] ?? "text";
    return {
      id: `${typeId}/field/f${i}`,
      typeId,
      key: `f${i}`,
      name: `字段 ${i + 1}`,
      dataType,
      options: dataType === "select" ? options : null,
      sort: 100 + i,
    };
  });
  if (fields.length) await database.db.insert(schema.fieldDef).values(fields);

  const { F, demoFlow } = demoSample;
  const roles = Object.fromEntries(
    [...new Set(demoFlow.nodes.flatMap((n) => n.ownerRoles))].map((r) => [r, [user.id]]),
  );
  const valueOf = (dataType: string, i: number, n: number): unknown => {
    if (dataType === "select") return options[(i + n) % options.length]?.value;
    if (dataType === "number") return (i * 7 + n) % 1000;
    if (dataType === "date") return `2027-${String(((i + n) % 12) + 1).padStart(2, "0")}-15`;
    return `第 ${n} 个工作项的字段 ${i + 1}`;
  };

  const started = Date.now();
  for (let n = 1; n <= count; n++) {
    const values: Record<string, unknown> = {
      [F.needPhaseOut]: n % 2 ? "是" : "否",
      [F.needLaunchPlan]: "是",
      [F.needResearch]: "否",
      [F.needVideo]: "是",
      [F.needCert]: "是",
      [F.linkedModel]: `M-${n}`,
    };
    fields.forEach((f, i) => {
      values[f.key] = valueOf(f.dataType, i, n);
    });
    await runner.run(
      "workItem.create",
      { id: randomUUID(), typeId, name: `压测项目 ${n}`, fields: values, roles },
      { userID: user.id },
    );
    if (n % 100 === 0) console.log(`${n} / ${count}，${Math.round((Date.now() - started) / 1000)} 秒`);
  }
  console.log(`空间 ${spaceId}：${count} 个工作项，每个 ${extraFields + Object.keys(F).length} 个字段`);
} finally {
  await database.close();
}
