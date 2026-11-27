import type { Database } from "@fp/db";
import type { ZeroContext } from "@fp/sync";
import { schema } from "@fp/sync";
import { mustGetMutator } from "@rocicorp/zero";
import { zeroDrizzle } from "@rocicorp/zero/server/adapters/drizzle";
import { withAudit } from "./audit.ts";
import { drizzleTx, serverMutators } from "./mutators.ts";

export { auditDetail, auditTarget, writeAudit } from "./audit.ts";
export { matchRules, runRule } from "./automation.ts";
export { HOUR_MS, tickAutomations } from "./automation-clock.ts";
export { failAutomationRequest, pendingRequests, sendAutomationRequest } from "./automation-requests.ts";
export { cascadeDependencies } from "./dependencies.ts";
export { cascadeLinks } from "./links.ts";
export { drizzleTx, serverMutators } from "./mutators.ts";
export {
  applySpaceSnapshot,
  MAX_TEMPLATE_ITEMS,
  type SpaceSnapshot,
  snapshotSpace,
  summarizeSnapshot,
} from "./space-copy.ts";

/** 在服务端事务里执行一个 mutator；要审计的操作在同一个事务里记审计日志。 */
export function runServerMutator(
  tx: Parameters<typeof drizzleTx>[0],
  name: string,
  args: unknown,
  ctx: ZeroContext,
): Promise<unknown> {
  const mutator = mustGetMutator(serverMutators, name);
  return withAudit(drizzleTx(tx), name, args, ctx, async () =>
    mutator.fn({ tx: tx as never, args: args as never, ctx }),
  );
}
export { notify } from "./notifications.ts";
export { cascadeSubItems } from "./subitems.ts";
export {
  type DeliverOptions,
  deliverWebhook,
  failWebhookDelivery,
  isPrivateAddress,
  matchWebhooks,
  WebhookBlockedError,
  webhookBody,
} from "./webhooks.ts";

/** 服务端执行 mutator：API 处理浏览器的写请求，worker 执行自动化动作，都走这里。 */
export function createMutatorRunner(database: Database) {
  const zqlDb = zeroDrizzle(schema, database.db);
  return {
    zqlDb,
    database,
    /** 在一个新的服务端事务里执行一个 mutator。 */
    run(name: string, args: unknown, ctx: ZeroContext) {
      return zqlDb.transaction((tx) => runServerMutator(tx, name, args, ctx));
    },
  };
}

export type MutatorRunner = ReturnType<typeof createMutatorRunner>;
