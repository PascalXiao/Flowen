import * as schema from "@fp/db/schema";
import { drizzleZeroConfig } from "drizzle-zero";

/**
 * 决定哪些表和列同步到浏览器。新表默认不同步，要在这里显式打开。
 * 改完运行 `pnpm --filter @fp/sync generate` 重新生成 src/schema.gen.ts。
 */
export default drizzleZeroConfig(schema, {
  tables: {
    user: { id: true, name: true, email: true, image: true },
    session: false,
    account: false,
    verification: false,
    space: true,
    spaceMember: true,
    businessLine: true,
    workItemType: true,
    fieldDef: true,
    roleDef: true,
    relationDef: true,
    flowTemplate: true,
    flowVersion: true,
    automationRule: true,
    savedView: true,
    attachment: true,
    comment: true,
    notification: true,
    workItem: true,
    fieldValue: true,
    fieldViewer: true,
    fieldValueItem: true,
    roleMember: true,
    workItemMark: true,
    workItemVisit: true,
    relation: true,
    nodeInstance: true,
    nodeConfirmation: true,
    nodeTask: true,
    eventLog: true,
    automationRun: true,
    webhook: true,
    webhookDelivery: true,
    apiToken: false,
    outbox: false,
    workItemEmbedding: false,
  },
});
