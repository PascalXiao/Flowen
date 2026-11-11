import { connect } from "@fp/db";
import { config } from "../config.ts";
import { importDemoTemplate } from "./demo.ts";

/** 用法：pnpm --filter @fp/api seed:demo <空间 id> */
const spaceId = process.argv[2];
if (!spaceId) {
  console.error("用法：pnpm --filter @fp/api seed:demo <空间 id>");
  process.exit(1);
}
const database = connect(config.databaseUrl);
try {
  const { typeId, templateId } = await importDemoTemplate(database.db, spaceId);
  console.log(`已导入示例流程：类型 ${typeId}，模板 ${templateId}`);
} finally {
  await database.close();
}
