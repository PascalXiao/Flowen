import type { Database } from "@fp/db";
import type { ZeroContext } from "@fp/sync";
import { schema } from "@fp/sync";
import { mustGetMutator } from "@rocicorp/zero";
import { zeroDrizzle } from "@rocicorp/zero/server/adapters/drizzle";
import { serverMutators } from "./mutators.ts";

export { matchRules, runRule } from "./automation.ts";
export { HOUR_MS, tickAutomations } from "./automation-clock.ts";
export { cascadeDependencies } from "./dependencies.ts";
export { drizzleTx, serverMutators } from "./mutators.ts";
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
      return zqlDb.transaction((tx) => mustGetMutator(serverMutators, name).fn({ tx, args: args as never, ctx }));
    },
  };
}

export type MutatorRunner = ReturnType<typeof createMutatorRunner>;
