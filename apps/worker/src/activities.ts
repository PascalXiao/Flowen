import type { Database } from "@fp/db";
import {
  cascadeDependencies,
  cascadeSubItems,
  createMutatorRunner,
  type DeliverOptions,
  deliverWebhook,
  failWebhookDelivery,
  matchRules,
  matchWebhooks,
  notify,
  runRule,
  tickAutomations,
  WebhookBlockedError,
} from "@fp/server";
import { ApplicationFailure, Context } from "@temporalio/activity";
import { config } from "./config.ts";

export interface ProcessEventResult {
  eventId: number;
  /** 被这条事件触发的规则：已启用，触发器和条件都满足。 */
  matchedRuleIds: string[];
  /** 要推送这条事件的 Webhook。 */
  webhookIds: string[];
}

/**
 * activity 是 workflow 里唯一可以碰数据库和网络的地方。
 * 每个 activity 都必须可以安全重试：Temporal 会在超时或失败时再次调用。
 */
export function createActivities(
  database: Database,
  webhookOptions: DeliverOptions = { allowPrivate: config.webhookAllowPrivate },
) {
  const runner = createMutatorRunner(database);

  return {
    /**
     * 处理一条事件：生成通知，推进子工作项驱动的父节点，放行在等这个节点的别的工作项，找出它触发的自动化规则和要推送的 Webhook。
     * 每步都可以安全重试。
     */
    async processEvent(eventId: number): Promise<ProcessEventResult> {
      await notify(database, eventId);
      await cascadeSubItems(runner, eventId);
      await cascadeDependencies(runner, eventId);
      return {
        eventId,
        matchedRuleIds: await matchRules(database, eventId),
        webhookIds: await matchWebhooks(database, eventId),
      };
    },

    /** 推送一次 Webhook。失败时抛出，由 workflow 按退避重试；地址被拦截时不再重试。 */
    async deliverWebhook(webhookId: string, eventId: number): Promise<string> {
      try {
        return await deliverWebhook(database, webhookId, eventId, webhookOptions);
      } catch (error) {
        if (error instanceof WebhookBlockedError)
          throw ApplicationFailure.nonRetryable(error.message, "WebhookBlocked");
        throw error;
      }
    },

    /** 重试用完仍然失败，记为失败。 */
    async failWebhook(webhookId: string, eventId: number): Promise<void> {
      await failWebhookDelivery(database, webhookId, eventId);
    },

    /** 时钟每个整点调一次：给到点的定时规则和动态时间规则写事件。可以安全重试。 */
    async tickAutomations(slot: number): Promise<number> {
      return tickAutomations(database, slot);
    },

    /** 执行一条规则。执行记录和动作在同一个事务里提交，重试时不会重复执行。 */
    async runRule(ruleId: string, eventId: number): Promise<string> {
      return runRule(runner, ruleId, eventId, Context.current().info.workflowExecution?.workflowId ?? "unknown");
    },
  };
}

export type Activities = ReturnType<typeof createActivities>;
