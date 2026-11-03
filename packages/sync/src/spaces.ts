import { checkBusinessLines } from "@fp/engine";
import type { Transaction } from "@rocicorp/zero";
import { z } from "zod";
import { assertSpaceMembers, requireAdmin } from "./access.ts";
import { isoDate, replanWorkItem } from "./flow.ts";
import { zql } from "./schema.gen.ts";

export const setCalendarArgs = z.object({
  spaceId: z.string(),
  holidays: z.array(isoDate).max(1000),
  extraWorkdays: z.array(isoDate).max(1000),
});
export type SetCalendarArgs = z.output<typeof setCalendarArgs>;

/**
 * 改空间的工作日历（节假日、调休上班），然后把空间里的工作项都按新日历重排。
 * 只有空间管理员可以改。返回改之前的配置，服务端用来写事件。
 */
export async function setSpaceCalendar(tx: Transaction, args: SetCalendarArgs, userID: string) {
  await requireAdmin(tx, args.spaceId, userID, "只有空间管理员可以修改工作日历。");
  const space = await tx.run(zql.space.where("id", args.spaceId).one());
  if (!space) throw new Error("空间不存在。");

  const holidays = [...new Set(args.holidays)].sort();
  const extraWorkdays = [...new Set(args.extraWorkdays)].sort();
  const both = holidays.find((day) => extraWorkdays.includes(day));
  if (both) throw new Error(`${both} 不能既放假又调休上班。`);

  await tx.mutate.space.update({ id: args.spaceId, calendar: { holidays, extraWorkdays } });
  const items = await tx.run(zql.workItem.where("spaceId", args.spaceId));
  for (const item of items) await replanWorkItem(tx, item.id, userID);
  return { from: space.calendar, to: { holidays, extraWorkdays } };
}

export const setBusinessLinesArgs = z.object({
  spaceId: z.string(),
  lines: z
    .array(
      z.object({
        id: z.string().min(1),
        name: z.string().trim().min(1).max(60),
        parentId: z.string().nullable(),
        admins: z.array(z.string()).max(50),
        disabled: z.boolean(),
      }),
    )
    .max(500),
});

/**
 * 整体保存空间的业务线树（顺序就是数组顺序）。只有空间管理员可以改。
 * 已经被工作项选了的业务线不能删，可以停用；业务线管理员要是空间成员。
 */
export async function setBusinessLines(tx: Transaction, args: z.output<typeof setBusinessLinesArgs>, userID: string) {
  await requireAdmin(tx, args.spaceId, userID, "只有空间管理员可以修改业务线。");
  const error = checkBusinessLines(args.lines);
  if (error) throw new Error(error);
  await assertSpaceMembers(
    tx,
    args.spaceId,
    args.lines.flatMap((l) => l.admins),
    "业务线管理员要是空间成员。",
  );
  const existing = await tx.run(zql.businessLine.where("spaceId", args.spaceId));
  const keep = new Set(args.lines.map((l) => l.id));
  const removed = existing.filter((l) => !keep.has(l.id));
  if (removed.length > 0) {
    const used = await tx.run(
      zql.fieldValueItem
        .where(
          "item",
          "IN",
          removed.map((l) => l.id),
        )
        .whereExists("fieldValue", (v) => v.whereExists("workItem", (w) => w.where("spaceId", args.spaceId)))
        .limit(1),
    );
    const line = removed.find((l) => l.id === used[0]?.item);
    if (line) throw new Error(`业务线「${line.name}」已经有工作项在用，不能删除，可以停用。`);
    for (const l of removed) await tx.mutate.businessLine.delete({ id: l.id });
  }
  for (const [sort, l] of args.lines.entries())
    await tx.mutate.businessLine.upsert({
      id: l.id,
      spaceId: args.spaceId,
      name: l.name,
      parentId: l.parentId,
      admins: l.admins.length > 0 ? [...new Set(l.admins)] : null,
      disabled: l.disabled,
      sort,
      createdAt: existing.find((e) => e.id === l.id)?.createdAt ?? Date.now(),
    });
}
