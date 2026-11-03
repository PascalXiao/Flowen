import {
  allHandlersFinished,
  condition,
  continueAsNew,
  defineSignal,
  ParentClosePolicy,
  proxyActivities,
  setHandler,
  sleep,
  startChild,
  workflowInfo,
} from "@temporalio/workflow";
import type { Activities } from "./activities.ts";
import {
  EVENT_SIGNAL,
  HOUR,
  type StreamEvent,
  type StreamWorkflowInput,
  type WebhookWorkflowInput,
  webhookWorkflowId,
} from "./shared.ts";

const { processEvent, runRule, tickAutomations } = proxyActivities<Activities>({
  startToCloseTimeout: "1 minute",
  retry: { initialInterval: "1 second", maximumInterval: "1 minute" },
});

/** Webhook 推送失败时的重试：10 秒、30 秒、1.5 分钟、4.5 分钟、13.5 分钟后各再试一次。 */
const webhook = proxyActivities<Activities>({
  startToCloseTimeout: "30 seconds",
  retry: {
    initialInterval: "10 seconds",
    backoffCoefficient: 3,
    maximumInterval: "30 minutes",
    maximumAttempts: 6,
    nonRetryableErrorTypes: ["WebhookBlocked"],
  },
});
const { failWebhook } = proxyActivities<Activities>({
  startToCloseTimeout: "1 minute",
  retry: { initialInterval: "1 second", maximumInterval: "1 minute" },
});

export const eventSignal = defineSignal<[StreamEvent]>(EVENT_SIGNAL);

/** 没有新事件多久之后结束；下一个事件到来时中继会用 signalWithStart 重新启动。 */
const IDLE_TIMEOUT = "1 hour";
/** 处理这么多事件后换一个新的运行，控制单次运行的历史长度。 */
const EVENTS_PER_RUN = 500;

/**
 * 一个事件流（一个工作项或一个空间）对应一个长期运行的 workflow，按 event_log 的顺序逐条处理事件。
 * 同一个工作项上的流程推进和自动化因此天然串行，不会互相踩。
 * 自动化动作写出的新事件也会回到这个流，但带着 causedBy，不会再触发规则。
 */
export async function streamWorkflow(input: StreamWorkflowInput): Promise<void> {
  const pending = [...input.pending];
  // 中继按 id 顺序投递同一个 stream 的事件，所以不大于已收到最大 id 的信号都是重复投递
  let lastSeenEventId = input.lastSeenEventId;

  setHandler(eventSignal, (event) => {
    if (event.eventId <= lastSeenEventId) return;
    lastSeenEventId = event.eventId;
    pending.push(event);
  });

  for (let processed = 0; ; ) {
    if (!(await condition(() => pending.length > 0, IDLE_TIMEOUT))) return;
    const next = pending.shift() as StreamEvent;
    // 规则按创建顺序逐条执行，前一条规则的改动后一条能看到
    const { matchedRuleIds, webhookIds = [] } = await processEvent(next.eventId);
    for (const ruleId of matchedRuleIds) await runRule(ruleId, next.eventId);
    // Webhook 各自在子 workflow 里推送和重试，接收方慢或挂了都不耽误这个流后面的事件
    for (const webhookId of webhookIds) await startWebhook({ webhookId, eventId: next.eventId });
    processed++;

    if (processed >= EVENTS_PER_RUN || workflowInfo().continueAsNewSuggested) {
      await condition(allHandlersFinished);
      await continueAsNew<typeof streamWorkflow>({ stream: input.stream, lastSeenEventId, pending });
    }
  }
}

async function startWebhook(input: WebhookWorkflowInput) {
  try {
    await startChild(webhookWorkflow, {
      workflowId: webhookWorkflowId(input),
      args: [input],
      parentClosePolicy: ParentClosePolicy.ABANDON,
    });
  } catch (error) {
    // 重复投递的事件：这次推送已经开始了
    if (!(error instanceof Error && error.name === "WorkflowExecutionAlreadyStartedError")) throw error;
  }
}

/** 把一条事件推送给一个 Webhook，失败按退避重试，用完重试次数记为失败。 */
export async function webhookWorkflow({ webhookId, eventId }: WebhookWorkflowInput): Promise<void> {
  try {
    await webhook.deliverWebhook(webhookId, eventId);
  } catch {
    await failWebhook(webhookId, eventId);
  }
}

/** 跑这么多个整点后换一个新的运行，控制历史长度。 */
const TICKS_PER_RUN = 24;

/**
 * 自动化时钟：睡到下一个整点，调 tickAutomations 给到点的规则写事件，如此往复。
 * workflow 里的时间是确定性的，worker 重启后从历史恢复，不会漏掉或重复整点（重复也会被 automation_fire 挡住）。
 */
export async function automationClockWorkflow(): Promise<void> {
  for (let i = 0; i < TICKS_PER_RUN; i++) {
    const now = Date.now();
    const next = (Math.floor(now / HOUR) + 1) * HOUR;
    await sleep(next - now);
    await tickAutomations(next);
  }
  await continueAsNew<typeof automationClockWorkflow>();
}
