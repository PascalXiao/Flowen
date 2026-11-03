/*
 * workflow 和普通 Node 代码都要用的常量。这个文件不能引入任何有副作用的模块，因为它会被打进 workflow 沙箱。
 */

export const STREAM_WORKFLOW = "streamWorkflow";
export const EVENT_SIGNAL = "event";

/** 中继投递给 workflow 的信号内容。只带事件 id，事件本身由 activity 从 event_log 读取。 */
export interface StreamEvent {
  eventId: number;
}

export interface StreamWorkflowInput {
  stream: string;
  /** 已经收到的最大事件 id，用来丢弃中继重复投递的信号。 */
  lastSeenEventId: number;
  /** continueAsNew 时还没来得及处理的事件。 */
  pending: StreamEvent[];
}

export function streamWorkflowId(stream: string): string {
  return `stream:${stream}`;
}

export interface WebhookWorkflowInput {
  webhookId: string;
  eventId: number;
}

export function webhookWorkflowId({ webhookId, eventId }: WebhookWorkflowInput): string {
  return `webhook:${webhookId}:${eventId}`;
}

/** 自动化时钟：全局只有一个，每个整点触发定时和动态时间规则。 */
export const CLOCK_WORKFLOW_ID = "automation-clock";
export const HOUR = 3_600_000;
