import { type FieldDataType, formatFieldValue } from "@fp/engine";
import { queries } from "@fp/sync";
import { useQuery } from "@rocicorp/zero/react";
import { useState } from "react";
import { Avatar } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import type { FieldConfig } from "./FieldInput";

/** 把事件里的键（节点、字段、角色、用户……）换成名字要用的配置。 */
export interface ActivityContext {
  nodeName: (key: string) => string;
  statusName: (key: string) => string;
  fields: readonly FieldConfig[];
  roles: readonly { key: string; name: string }[];
  relationDefs: readonly { id: string; name: string }[];
  userName: (id: string) => string;
  itemName: (id: string) => string | undefined;
}

const PAGE = 50;

type Payload = Record<string, unknown>;
const str = (v: unknown) => (typeof v === "string" ? v : "");
const list = (v: unknown) => (Array.isArray(v) ? v.map(String) : []);

/** 一条事件的文字描述；不认识或不值得展示的事件返回 null。 */
export function describeEvent(kind: string, p: Payload, ctx: ActivityContext): string | null {
  const node = () => `节点「${ctx.nodeName(str(p.node))}」`;
  const fieldLabel = (key: string) => ctx.fields.find((f) => f.key === key)?.name ?? key;
  switch (kind) {
    case "workItemCreated":
      return "创建了工作项";
    case "workItemCompleted":
      return "工作项已完成";
    case "workItemReopened":
      return "工作项重新打开";
    case "nodeStarted":
      return `${node()}开始`;
    case "nodeConfirmed":
      return `确认了${node()}`;
    case "nodeCompleted":
      return p.by ? `完成了${node()}` : `${node()}已完成`;
    case "nodeSkipped":
      return `${node()}不满足条件，已跳过`;
    case "nodeRestored":
      return `${node()}恢复`;
    case "nodeRolledBack":
      return `回滚到${node()}`;
    case "nodeNudged":
      return `催了${node()}的负责人`;
    case "stageChanged":
      return `阶段变为「${str(p.to)}」`;
    case "templateUpgraded":
      return "把流程升级到了模板的最新版本";
    case "nodeEffortChanged": {
      const parts = [
        p.points !== undefined && `估分 ${p.points ?? "清空"}`,
        p.actualHours !== undefined && `实际工时 ${p.actualHours ?? "清空"}`,
      ].filter(Boolean);
      return `把${node()}的${parts.join("、")}`;
    }
    case "workItemTerminated":
      return p.reason ? `终止了工作项，原因：${str(p.reason)}` : "终止了工作项";
    case "workItemRestored":
      return "恢复了工作项";
    case "workItemDeleted":
      return "删除了工作项（放进回收站）";
    case "workItemRecovered":
      return "从回收站恢复了工作项";
    case "workItemFrozen":
      return "冻结了工作项";
    case "workItemUnfrozen":
      return "解冻了工作项";
    case "statusChanged":
      return `把状态从「${ctx.statusName(str(p.from))}」改为「${ctx.statusName(str(p.to))}」`;
    case "nodePlanChanged": {
      const range = [str(p.start), str(p.end)].filter(Boolean).join(" ~ ");
      return range ? `把${node()}的排期改为 ${range}` : `清空了${node()}的排期`;
    }
    case "fieldChanged": {
      const key = str(p.fieldKey);
      const def = ctx.fields.find((f) => f.key === key);
      const field = {
        name: def?.name ?? key,
        dataType: (def?.dataType ?? "text") as FieldDataType,
        options: def?.options,
      };
      const show = (v: unknown) => formatFieldValue(field, v, ctx.userName) || "空";
      return `把「${field.name}」从 ${show(p.from)} 改为 ${show(p.to)}`;
    }
    case "nodeOwnerChanged":
      return `把节点「${ctx.nodeName(str(p.nodeKey))}」的负责人从 ${list(p.from).map(ctx.userName).join("、") || "无"} 移交给 ${list(p.to).map(ctx.userName).join("、") || "无"}`;
    case "taskAssigned":
      return `把子任务从 ${ctx.userName(str(p.from))} 移交给 ${ctx.userName(str(p.to))}`;
    case "roleChanged": {
      const role = ctx.roles.find((r) => r.key === p.roleKey)?.name ?? str(p.roleKey);
      const from = list(p.from);
      const to = list(p.to);
      const names = (ids: string[]) => ids.map(ctx.userName).join("、");
      const added = to.filter((u) => !from.includes(u));
      const removed = from.filter((u) => !to.includes(u));
      return [
        added.length > 0 && `把 ${names(added)} 设为「${role}」`,
        removed.length > 0 && `从「${role}」移除了 ${names(removed)}`,
      ]
        .filter(Boolean)
        .join("，");
    }
    case "commentAdded":
      return p.parentId ? "回复了评论" : "发表了评论";
    case "voteCast":
      return `在「${fieldLabel(str(p.fieldKey))}」投了票`;
    case "voteRevealed":
      return `${p.revealed ? "公布" : "收起"}了「${fieldLabel(str(p.fieldKey))}」的投票结果`;
    case "commentEdited":
      return "编辑了评论";
    case "commentDeleted":
      return "删除了评论";
    case "attachmentAdded":
      return `上传了附件「${str(p.name)}」`;
    case "attachmentRemoved":
      return `删除了附件「${str(p.name)}」`;
    case "dependencyAdded": {
      const target = `${p.targetItemName ? `${str(p.targetItemName)} · ` : ""}${str(p.targetNode)}`;
      return `给${node()}加了依赖：要等「${target}」完成才能${p.allow === "start" ? "开始" : "完成"}`;
    }
    case "dependencyRemoved":
      return `删除了${node()}对「${str(p.targetNode)}」的依赖`;
    case "baselineSaved":
      return `存了计划基线「${str(p.name)}」`;
    case "baselineDeleted":
      return `删除了计划基线「${str(p.name)}」`;
    case "taskCreated":
      return `在${node()}添加了子任务「${str(p.name)}」`;
    case "taskUpdated":
      return p.assigneeId !== undefined
        ? `把子任务「${str(p.name)}」${p.assigneeId ? `交给 ${ctx.userName(str(p.assigneeId))}` : "设为无人负责"}`
        : `修改了子任务「${str(p.name)}」`;
    case "taskDone":
      return `完成了子任务「${str(p.name)}」`;
    case "taskReopened":
      return `重新打开了子任务「${str(p.name)}」`;
    case "taskDeleted":
      return `删除了子任务「${str(p.name)}」`;
    case "relationAdded":
    case "relationRemoved": {
      const def = ctx.relationDefs.find((d) => d.id === p.relationDefId)?.name ?? "关联";
      const target = ctx.itemName(str(p.toId));
      return `${kind === "relationAdded" ? "添加" : "移除"}了「${def}」${target ? `：${target}` : ""}`;
    }
    case "subItemCreated":
      return `在${node()}下创建了子工作项「${str(p.name)}」`;
    default:
      return null;
  }
}

/**
 * 工作项动态：谁在什么时候做了什么，新的在前。数据来自事件日志，
 * 受限字段的改动只同步给能看到这个字段的人。
 */
export function ActivityCard({ workItemId, context }: { workItemId: string; context: ActivityContext }) {
  const [limit, setLimit] = useState(PAGE);
  const [events, result] = useQuery(queries.workItems.activity({ workItemId, limit }));
  const rows = events.flatMap((e) => {
    const text = describeEvent(e.kind, e.payload, context);
    return text ? [{ ...e, text }] : [];
  });

  return (
    <div className="flex flex-col gap-3 text-sm">
      {rows.length === 0 && <p className="text-fg-subtle">{result.type === "complete" ? "还没有动态。" : "加载中…"}</p>}
      <ol aria-label="动态列表" className="flex flex-col gap-3">
        {rows.map((e) => {
          const who = e.actorUser?.name ?? (e.actor ? e.actor : "系统");
          return (
            <li key={e.id} className="flex gap-2.5">
              <Avatar id={e.actor ?? undefined} name={who} size={24} />
              <div className="flex min-w-0 flex-col gap-0.5">
                <p className="break-words">
                  <span className="font-medium">{who}</span>
                  {e.causedBy !== null && <span className="text-fg-subtle">（自动化）</span>} {e.text}
                </p>
                <span className="text-xs text-fg-subtle">{e.at ? new Date(e.at).toLocaleString("zh-CN") : ""}</span>
              </div>
            </li>
          );
        })}
      </ol>
      {events.length >= limit && (
        <Button variant="link" size="sm" className="self-start" onClick={() => setLimit(limit + PAGE)}>
          查看更早的动态
        </Button>
      )}
    </div>
  );
}
