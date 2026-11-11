import { randomUUID } from "node:crypto";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { schema } from "@fp/db";
import { createTestDatabase } from "@fp/db/testing";
import { dayInTimeZone, dayToIso, demoSample, type FlowDefinition } from "@fp/engine";
import {
  cascadeDependencies,
  cascadeSubItems,
  createMutatorRunner,
  matchRules,
  notify,
  runRule,
  tickAutomations,
} from "@fp/server";
import { and, desc, eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createApp, createServices, type Services } from "../src/app.ts";
import type { Dashboard } from "../src/dashboard.ts";
import { importDemoTemplate } from "../src/seed/demo.ts";

let services: Services;
let app: ReturnType<typeof createApp>;

beforeAll(async () => {
  services = createServices(await createTestDatabase("fp_test_api"), await mkdtemp(join(tmpdir(), "fp-files-")));
  app = createApp(services);
});

afterAll(() => services?.database.close());

async function signUp(email: string): Promise<{ cookie: string; userId: string }> {
  const res = await app.request("/api/auth/sign-up/email", {
    method: "POST",
    headers: { "content-type": "application/json", origin: "http://localhost:5173" },
    body: JSON.stringify({ email, password: "correct-horse-battery", name: email.split("@")[0] }),
  });
  expect(res.status).toBe(200);
  const cookie = (res.headers.get("set-cookie") ?? "").split(";")[0] as string;
  const body = (await res.json()) as { user: { id: string } };
  return { cookie, userId: body.user.id };
}

describe("login + Zero mutators", () => {
  const spaceId = randomUUID();
  const workItemId = randomUUID();
  let owner: { cookie: string; userId: string };

  it("signs up and resolves the session from the cookie", async () => {
    owner = await signUp("pascal@example.com");
    const res = await app.request("/api/auth/get-session", { headers: { cookie: owner.cookie } });
    expect(((await res.json()) as { user: { id: string } }).user.id).toBe(owner.userId);

    // 会话存在 infra schema 里
    const sessions = await services.database.db
      .select()
      .from(schema.session)
      .where(eq(schema.session.userId, owner.userId));
    expect(sessions).toHaveLength(1);
  });

  it("space.create makes the creator an admin member", async () => {
    await services.zero.run("space.create", { id: spaceId, name: "测试空间" }, owner.userId);
    const [member] = await services.database.db
      .select()
      .from(schema.spaceMember)
      .where(eq(schema.spaceMember.spaceId, spaceId));
    expect(member).toMatchObject({ userId: owner.userId, role: "admin" });
  });

  it("fieldValue.set writes the value and its event in one transaction", async () => {
    const { db } = services.database;
    await db.insert(schema.workItemType).values({ id: `${spaceId}-t`, spaceId, key: "project", name: "项目" });
    await db.insert(schema.fieldDef).values({
      id: `${spaceId}-f`,
      typeId: `${spaceId}-t`,
      key: "needResearch",
      name: "是否需要用户调研",
      dataType: "select",
      options: [
        { value: "是", label: "是" },
        { value: "否", label: "否" },
      ],
    });
    await db.insert(schema.workItem).values({
      id: workItemId,
      spaceId,
      typeId: `${spaceId}-t`,
      name: "示例项目",
      createdBy: owner.userId,
    });

    await services.zero.run("fieldValue.set", { workItemId, fieldKey: "needResearch", value: "是" }, owner.userId);
    await services.zero.run("fieldValue.set", { workItemId, fieldKey: "needResearch", value: "否" }, owner.userId);

    const [value] = await db
      .select()
      .from(schema.fieldValue)
      .where(and(eq(schema.fieldValue.workItemId, workItemId), eq(schema.fieldValue.fieldKey, "needResearch")));
    expect(value?.value).toBe("否");

    const events = await db.select().from(schema.eventLog).where(eq(schema.eventLog.workItemId, workItemId));
    expect(events.map((e) => [e.kind, e.payload, e.actor])).toEqual([
      ["fieldChanged", { fieldKey: "needResearch", from: null, to: "是" }, owner.userId],
      ["fieldChanged", { fieldKey: "needResearch", from: "是", to: "否" }, owner.userId],
    ]);
    const outbox = await db.select().from(schema.outbox);
    expect(outbox.map((o) => o.stream)).toEqual([`work_item:${workItemId}`, `work_item:${workItemId}`]);
  });

  it("rejects writes from someone outside the space and leaves no event behind", async () => {
    const stranger = await signUp("stranger@example.com");
    await expect(
      services.zero.run("fieldValue.set", { workItemId, fieldKey: "x", value: 1 }, stranger.userId),
    ).rejects.toThrow("没有权限");
    expect(await services.database.db.$count(schema.eventLog)).toBe(2);
  });

  it("serves named queries to logged-in users only", async () => {
    const body = JSON.stringify(["transform", [{ id: "q1", name: "workItems.bySpace", args: [{ spaceId }] }]]);
    const url = "/api/zero/query?schema=zero_0&appID=zero";
    const anonymous = await app.request(url, { method: "POST", body });
    expect(anonymous.status).toBe(401);

    const res = await app.request(url, { method: "POST", body, headers: { cookie: owner.cookie } });
    expect(res.status).toBe(200);
    const json = (await res.json()) as { userID: string; queries: { id: string; ast: { table: string } }[] };
    expect(json.userID).toBe(owner.userId);
    expect(json.queries.map((q) => [q.id, q.ast.table])).toEqual([["q1", "work_item"]]);
    // 权限过滤被写进了发给 zero-cache 的查询里
    expect(JSON.stringify(json.queries[0]?.ast)).toContain(owner.userId);
  });
});

describe("workItem.create with 示例流程", () => {
  const spaceId = randomUUID();
  let npd: { cookie: string; userId: string };
  let finance: { cookie: string; userId: string };
  let dev: { cookie: string; userId: string };
  let typeId: string;

  beforeAll(async () => {
    npd = await signUp(`npd-${spaceId}@example.com`);
    finance = await signUp(`finance-${spaceId}@example.com`);
    dev = await signUp(`dev-${spaceId}@example.com`);
    await services.zero.run("space.create", { id: spaceId, name: "示例空间" }, npd.userId);
    await services.database.db.insert(schema.spaceMember).values([
      { spaceId, userId: finance.userId },
      { spaceId, userId: dev.userId },
    ]);
    ({ typeId } = await importDemoTemplate(services.database.db, spaceId));
  });

  async function create(fields: Record<string, string>) {
    const id = randomUUID();
    await services.zero.run(
      "workItem.create",
      {
        id,
        typeId,
        name: "新品 A",
        fields,
        roles: { NPD: [npd.userId], 财务BP负责人: [finance.userId], 开发: [dev.userId] },
      },
      npd.userId,
    );
    const { db } = services.database;
    const [item] = await db.select().from(schema.workItem).where(eq(schema.workItem.id, id));
    const nodes = await db.select().from(schema.nodeInstance).where(eq(schema.nodeInstance.workItemId, id));
    const events = await db
      .select()
      .from(schema.eventLog)
      .where(eq(schema.eventLog.workItemId, id))
      .orderBy(schema.eventLog.id);
    return { id, item, node: (key: string) => nodes.find((n) => n.nodeKey === key), nodes, events };
  }

  const { F } = demoSample;
  const fields = {
    [F.needPhaseOut]: "是",
    [F.needLaunchPlan]: "是",
    [F.needResearch]: "否",
    [F.needVideo]: "是",
    [F.needCert]: "是",
  };

  it("completes the start node, opens 立项提案 for its three owners and sets the stage", async () => {
    const { item, node, nodes, events } = await create(fields);
    expect(item).toMatchObject({ stage: "概念阶段", status: "inProgress", createdBy: npd.userId });
    expect(nodes).toHaveLength(48);
    expect(node("start")?.state).toBe("completed");
    expect(node("doing")).toMatchObject({
      state: "inProgress",
      owners: [npd.userId, finance.userId, dev.userId],
    });
    expect(node("doing")?.actualStart).toBeInstanceOf(Date);
    expect(node("state_51")?.state).toBe("notStarted");

    expect(events[0]).toMatchObject({ kind: "workItemCreated", actor: npd.userId });
    expect(events.map((e) => e.kind)).toEqual(expect.arrayContaining(["nodeStarted", "stageChanged", "nodeCompleted"]));
    expect(events.find((e) => e.kind === "nodeCompleted")?.payload).toEqual({ node: "start", by: null });
    // 每条事件都进了 outbox，交给 Temporal
    const outbox = await services.database.db.select().from(schema.outbox);
    for (const e of events) expect(outbox.some((o) => o.eventId === e.id)).toBe(true);
  });

  it("skips the phase-out branch when its switch is off", async () => {
    const { node } = await create({ ...fields, [F.needPhaseOut]: "否", [F.needLaunchPlan]: "否" });
    for (const key of ["state_53", "state_54", "state_55", "state_56", "state_0"])
      expect(node(key)?.state).toBe("skipped");
  });

  it("refuses users outside the space", async () => {
    const stranger = await signUp(`stranger-${spaceId}@example.com`);
    await expect(
      services.zero.run("workItem.create", { id: randomUUID(), typeId, name: "x" }, stranger.userId),
    ).rejects.toThrow("没有权限");
  });

  async function reload(id: string) {
    const { db } = services.database;
    const [item] = await db.select().from(schema.workItem).where(eq(schema.workItem.id, id));
    const nodes = await db.select().from(schema.nodeInstance).where(eq(schema.nodeInstance.workItemId, id));
    const confirmations = await db.select().from(schema.nodeConfirmation);
    const events = await db
      .select()
      .from(schema.eventLog)
      .where(eq(schema.eventLog.workItemId, id))
      .orderBy(schema.eventLog.id);
    return {
      item,
      node: (key: string) => nodes.find((n) => n.nodeKey === key),
      confirmedBy: (key: string) =>
        confirmations.filter((c) => c.nodeInstanceId === `${id}/${key}`).map((c) => c.userId),
      events,
    };
  }

  it("needs all three owners to confirm 立项提案, then starts 财务分析", async () => {
    const { id } = await create({ ...fields, [F.linkedModel]: "SKU-001" });
    const confirm = (userId: string) => services.zero.run("node.confirm", { workItemId: id, nodeKey: "doing" }, userId);

    await confirm(npd.userId);
    let now = await reload(id);
    expect(now.node("doing")?.state).toBe("inProgress");
    expect(now.confirmedBy("doing")).toEqual([npd.userId]);

    await confirm(finance.userId);
    await confirm(dev.userId);
    now = await reload(id);
    expect(now.node("doing")).toMatchObject({ state: "completed", actualEnd: expect.any(Date) });
    expect(now.node("state_51")).toMatchObject({ state: "inProgress", actualStart: expect.any(Date) });

    const kinds = now.events.map((e) => [e.kind, (e.payload as { node?: string }).node, e.actor]);
    expect(kinds).toEqual(
      expect.arrayContaining([
        ["nodeConfirmed", "doing", npd.userId],
        ["nodeCompleted", "doing", dev.userId],
        ["nodeStarted", "state_51", null],
      ]),
    );
  });

  it("refuses a confirm from someone who is not an owner and writes nothing", async () => {
    const { id } = await create(fields);
    const outsider = await signUp(`member-${randomUUID()}@example.com`);
    await services.database.db.insert(schema.spaceMember).values({ spaceId, userId: outsider.userId });
    const before = (await reload(id)).events.length;
    await expect(
      services.zero.run("node.confirm", { workItemId: id, nodeKey: "doing" }, outsider.userId),
    ).rejects.toThrow("负责人");
    expect((await reload(id)).events).toHaveLength(before);
  });

  it("rolls back to 立项提案: clears its confirmations and reopens it, later nodes go back to not started", async () => {
    const { id } = await create({ ...fields, [F.linkedModel]: "SKU-001" });
    for (const u of [npd, finance, dev])
      await services.zero.run("node.confirm", { workItemId: id, nodeKey: "doing" }, u.userId);

    await services.zero.run("node.rollback", { workItemId: id, nodeKey: "doing" }, npd.userId);
    const now = await reload(id);
    expect(now.node("doing")).toMatchObject({ state: "inProgress", actualEnd: null });
    expect(now.confirmedBy("doing")).toEqual([]);
    expect(now.node("state_51")).toMatchObject({ state: "notStarted", actualStart: null });
    expect(now.events.at(-1)?.kind).toBe("nodeRolledBack");
  });

  it("changing a role re-assigns the open nodes it owns and drops the replaced owner's confirmation", async () => {
    const { id } = await create({ ...fields, [F.linkedModel]: "SKU-001" });
    await services.zero.run("node.confirm", { workItemId: id, nodeKey: "doing" }, finance.userId);
    await services.zero.run("node.confirm", { workItemId: id, nodeKey: "doing" }, dev.userId);

    // 开发换成 NPD 本人：立项提案的负责人变成 NPD 和财务，开发的确认作废
    await services.zero.run("role.set", { workItemId: id, roleKey: "开发", userIds: [npd.userId] }, npd.userId);
    const now = await reload(id);
    expect(now.node("doing")?.owners).toEqual([npd.userId, finance.userId]);
    expect(now.confirmedBy("doing")).toEqual([finance.userId]);
    expect(now.events.at(-1)).toMatchObject({
      kind: "roleChanged",
      payload: { roleKey: "开发", from: [dev.userId], to: [npd.userId] },
    });

    await services.zero.run("node.confirm", { workItemId: id, nodeKey: "doing" }, npd.userId);
    expect((await reload(id)).node("doing")?.state).toBe("completed");
  });

  it("only accepts space members in roles", async () => {
    const stranger = await signUp(`role-${randomUUID()}@example.com`);
    const { id } = await create(fields);
    await expect(
      services.zero.run("role.set", { workItemId: id, roleKey: "开发", userIds: [stranger.userId] }, npd.userId),
    ).rejects.toThrow("空间成员");
  });

  it("plans every node on create and re-plans downstream when a node's dates are set by hand", async () => {
    const { id } = await create({ ...fields, [F.linkedModel]: "SKU-001" });
    const day = (ms: Date | null | undefined) => (ms ? ms.toISOString().slice(0, 10) : null);
    let now = await reload(id);
    const today = dayToIso(dayInTimeZone(Date.now(), "Asia/Shanghai"));
    expect(day(now.node("start")?.plannedStart)).toBe(today);
    const financeStart = now.node("state_51")?.plannedStart as Date;
    expect(financeStart.getTime()).toBeGreaterThan((now.node("doing")?.plannedEnd as Date).getTime());

    // 立项提案手动定到 12 月，后面的财务分析跟着顺延到它之后的第一个工作日
    await services.zero.run(
      "node.setPlan",
      { workItemId: id, nodeKey: "doing", start: "2026-12-01", end: "2026-12-04" },
      npd.userId,
    );
    now = await reload(id);
    expect(now.node("doing")).toMatchObject({ plannedPinned: true });
    expect(day(now.node("doing")?.plannedEnd)).toBe("2026-12-04");
    expect(day(now.node("state_51")?.plannedStart)).toBe("2026-12-07"); // 12-04 是周五
    expect(now.events.at(-1)).toMatchObject({ kind: "nodePlanChanged", payload: { node: "doing" } });

    // 取消手动日期，回到自动排期
    await services.zero.run("node.setPlan", { workItemId: id, nodeKey: "doing" }, npd.userId);
    now = await reload(id);
    expect(now.node("doing")?.plannedPinned).toBe(false);
    expect(now.node("state_51")?.plannedStart).toEqual(financeStart);
  });

  it("refuses plan changes from someone who does not own the node", async () => {
    const { id } = await create(fields);
    const outsider = await signUp(`plan-${randomUUID()}@example.com`);
    await services.database.db.insert(schema.spaceMember).values({ spaceId, userId: outsider.userId });
    await expect(
      services.zero.run(
        "node.setPlan",
        { workItemId: id, nodeKey: "doing", start: "2026-12-01", end: "2026-12-02" },
        outsider.userId,
      ),
    ).rejects.toThrow("负责人");
  });

  it("re-plans the space's work items when the admin changes the work calendar", async () => {
    const { id } = await create({ ...fields, [F.linkedModel]: "SKU-002" });
    const day = (ms: Date | null | undefined) => (ms ? ms.toISOString().slice(0, 10) : null);
    await services.zero.run(
      "node.setPlan",
      { workItemId: id, nodeKey: "doing", start: "2026-12-01", end: "2026-12-04" },
      npd.userId,
    );
    expect(day((await reload(id)).node("state_51")?.plannedStart)).toBe("2026-12-07");

    // 12-07（周一）放假：财务分析顺延到 12-08
    const setCalendar = (holidays: string[], extraWorkdays: string[], userId = npd.userId) =>
      services.zero.run("space.setCalendar", { spaceId, holidays, extraWorkdays }, userId);
    await setCalendar(["2026-12-07"], []);
    expect(day((await reload(id)).node("state_51")?.plannedStart)).toBe("2026-12-08");
    // 12-05（周六）调休上班：财务分析提前到 12-05
    await setCalendar(["2026-12-07"], ["2026-12-05"]);
    expect(day((await reload(id)).node("state_51")?.plannedStart)).toBe("2026-12-05");

    const [space] = await services.database.db.select().from(schema.space).where(eq(schema.space.id, spaceId));
    expect(space?.calendar).toEqual({ holidays: ["2026-12-07"], extraWorkdays: ["2026-12-05"] });
    const events = await services.database.db
      .select()
      .from(schema.eventLog)
      .where(eq(schema.eventLog.spaceId, spaceId))
      .orderBy(schema.eventLog.id);
    expect(events.at(-1)).toMatchObject({ kind: "calendarChanged", workItemId: null });

    await expect(setCalendar([], [], finance.userId)).rejects.toThrow("管理员");
    await expect(setCalendar(["2026-12-05"], ["2026-12-05"])).rejects.toThrow("既放假又调休");
    await setCalendar([], []);
    expect(day((await reload(id)).node("state_51")?.plannedStart)).toBe("2026-12-07");
  });

  it("re-evaluates node visibility when a switch field changes", async () => {
    const { id } = await create(fields);
    expect((await reload(id)).node("state_53")?.state).toBe("notStarted");

    await services.zero.run("fieldValue.set", { workItemId: id, fieldKey: F.needPhaseOut, value: "否" }, npd.userId);
    const now = await reload(id);
    expect(now.node("state_53")?.state).toBe("skipped");
    const changed = now.events.findIndex((e) => e.kind === "fieldChanged");
    const skipped = now.events.slice(changed + 1).map((e) => [e.kind, (e.payload as { node: string }).node]);
    expect(skipped).toContainEqual(["nodeSkipped", "state_53"]);
  });
  it("deletes into the recycle bin, recovers, and purges with cascade while keeping the event log", async () => {
    const { db } = services.database;
    const { id } = await create(fields);
    const row = async () => (await db.select().from(schema.workItem).where(eq(schema.workItem.id, id)))[0];
    // 开发既不是创建者也不是负责人：默认不能删
    await expect(services.zero.run("workItem.delete", { workItemId: id }, dev.userId)).rejects.toThrow(/没有权限删除/);
    await services.zero.run("workItem.delete", { workItemId: id }, npd.userId);
    expect((await row())?.deletedBy).toBe(npd.userId);
    expect((await row())?.deletedAt).toBeInstanceOf(Date);
    // 删除后其他操作都找不到它
    await expect(services.zero.run("workItem.terminate", { workItemId: id }, npd.userId)).rejects.toThrow(/不存在/);
    // 只有删除的人和管理员能恢复（npd 是空间创建者，也是管理员）
    await expect(services.zero.run("workItem.recover", { workItemId: id }, dev.userId)).rejects.toThrow(/删除它的人/);
    await services.zero.run("workItem.recover", { workItemId: id }, npd.userId);
    expect((await row())?.deletedAt).toBeNull();
    await expect(services.zero.run("workItem.purge", { workItemId: id }, npd.userId)).rejects.toThrow(/回收站里没有/);

    await services.zero.run("workItem.delete", { workItemId: id }, npd.userId);
    await services.zero.run("workItem.purge", { workItemId: id }, npd.userId);
    expect(await row()).toBeUndefined();
    expect(await db.select().from(schema.nodeInstance).where(eq(schema.nodeInstance.workItemId, id))).toEqual([]);
    expect(await db.select().from(schema.fieldValue).where(eq(schema.fieldValue.workItemId, id))).toEqual([]);
    const purged = await db
      .select()
      .from(schema.eventLog)
      .where(and(eq(schema.eventLog.spaceId, spaceId), eq(schema.eventLog.kind, "workItemPurged")));
    expect(purged.map((e) => e.payload)).toContainEqual({ id, name: "新品 A" });
    const kinds = (
      await db.select({ kind: schema.eventLog.kind }).from(schema.eventLog).where(eq(schema.eventLog.spaceId, spaceId))
    ).map((e) => e.kind);
    expect(kinds).toEqual(expect.arrayContaining(["workItemCreated", "workItemDeleted", "workItemRecovered"]));
  });
  it("hands over a member's roles, open nodes and tasks to someone else", async () => {
    const { db } = services.database;
    const { id } = await create(fields);
    const devNodes = async () =>
      (await db.select().from(schema.nodeInstance).where(eq(schema.nodeInstance.workItemId, id))).filter(
        (n) => (n.state === "notStarted" || n.state === "inProgress") && n.owners.includes(dev.userId),
      );
    expect((await devNodes()).length).toBeGreaterThan(0);
    const [open] = await devNodes();
    await db.insert(schema.nodeTask).values({
      id: randomUUID(),
      workItemId: id,
      nodeKey: open?.nodeKey as string,
      name: "打样",
      assigneeId: dev.userId,
    });

    const args = { spaceId, fromUserId: dev.userId, toUserId: finance.userId };
    await expect(services.zero.run("space.handover", args, dev.userId)).rejects.toThrow(/只有空间管理员/);
    await services.zero.run("space.handover", args, npd.userId);

    expect(await devNodes()).toEqual([]);
    const members = await db.select().from(schema.roleMember).where(eq(schema.roleMember.workItemId, id));
    expect(members.filter((m) => m.roleKey === "开发").map((m) => m.userId)).toEqual([finance.userId]);
    const tasks = await db.select().from(schema.nodeTask).where(eq(schema.nodeTask.workItemId, id));
    expect(tasks.map((t) => t.assigneeId)).toEqual([finance.userId]);
    const kinds = (
      await db.select({ kind: schema.eventLog.kind }).from(schema.eventLog).where(eq(schema.eventLog.workItemId, id))
    ).map((e) => e.kind);
    expect(kinds).toEqual(expect.arrayContaining(["roleChanged", "taskAssigned"]));
    const [summary] = await db
      .select()
      .from(schema.eventLog)
      .where(and(eq(schema.eventLog.spaceId, spaceId), eq(schema.eventLog.kind, "workHandover")))
      .orderBy(desc(schema.eventLog.id))
      .limit(1);
    expect(summary?.payload).toMatchObject({ from: dev.userId, to: finance.userId });
  });

  it("saves plan baselines; only the saver or an admin can delete one", async () => {
    const { db } = services.database;
    const { id } = await create(fields);
    const baselineId = randomUUID();
    await services.zero.run("baseline.save", { id: baselineId, workItemId: id, name: "立项" }, dev.userId);
    const [saved] = await db.select().from(schema.planBaseline).where(eq(schema.planBaseline.workItemId, id));
    const planned = (await db.select().from(schema.nodeInstance).where(eq(schema.nodeInstance.workItemId, id))).filter(
      (n) => n.state !== "skipped" && n.plannedStart && n.plannedEnd,
    );
    expect(saved?.name).toBe("立项");
    expect(Object.keys(saved?.nodes ?? {}).sort()).toEqual(planned.map((n) => n.nodeKey).sort());
    expect(Object.values(saved?.nodes ?? {})[0]).toMatchObject({ start: expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/) });

    await expect(services.zero.run("baseline.delete", { id: baselineId }, finance.userId)).rejects.toThrow(
      /只有存基线的人或空间管理员/,
    );
    await services.zero.run("baseline.delete", { id: baselineId }, npd.userId);
    expect(await db.select().from(schema.planBaseline).where(eq(schema.planBaseline.workItemId, id))).toEqual([]);
    const kinds = (
      await db.select({ kind: schema.eventLog.kind }).from(schema.eventLog).where(eq(schema.eventLog.workItemId, id))
    ).map((e) => e.kind);
    expect(kinds).toEqual(expect.arrayContaining(["baselineSaved", "baselineDeleted"]));
  });
});

describe("POST /api/spaces/:spaceId/members", () => {
  it("lets the space admin add a registered user by email", async () => {
    const spaceId = randomUUID();
    const admin = await signUp(`admin-${spaceId}@example.com`);
    const colleague = await signUp(`colleague-${spaceId}@example.com`);
    await services.zero.run("space.create", { id: spaceId, name: "成员" }, admin.userId);
    const add = (cookie: string, email: string) =>
      app.request(`/api/spaces/${spaceId}/members`, {
        method: "POST",
        headers: { cookie, "content-type": "application/json" },
        body: JSON.stringify({ email }),
      });

    expect((await add(colleague.cookie, `colleague-${spaceId}@example.com`)).status).toBe(403);
    expect((await add(admin.cookie, "nobody@example.com")).status).toBe(404);
    const ok = await add(admin.cookie, `Colleague-${spaceId}@example.com`);
    expect(ok.status).toBe(200);
    expect(await ok.json()).toEqual({ userId: colleague.userId, name: `colleague-${spaceId}` });
    expect((await add(admin.cookie, `colleague-${spaceId}@example.com`)).status).toBe(409);
  });
});

describe("POST /api/spaces/:spaceId/import-demo", () => {
  it("lets the space admin import once and refuses everyone else", async () => {
    const spaceId = randomUUID();
    const admin = await signUp(`admin-${spaceId}@example.com`);
    const other = await signUp(`other-${spaceId}@example.com`);
    await services.zero.run("space.create", { id: spaceId, name: "演示" }, admin.userId);
    const url = `/api/spaces/${spaceId}/import-demo`;

    expect((await app.request(url, { method: "POST", headers: { cookie: other.cookie } })).status).toBe(403);
    const ok = await app.request(url, { method: "POST", headers: { cookie: admin.cookie } });
    expect(ok.status).toBe(200);
    expect(await ok.json()).toEqual({ typeId: `${spaceId}/project`, templateId: `${spaceId}/project/standard` });
    expect((await app.request(url, { method: "POST", headers: { cookie: admin.cookie } })).status).toBe(409);
  });
});

describe("configuring a type and its flow template", () => {
  const spaceId = randomUUID();
  const typeId = `${spaceId}/bug`;
  const templateId = `${typeId}/default`;
  let admin: { cookie: string; userId: string };
  let member: { cookie: string; userId: string };
  const run = (name: string, args: unknown, userId = admin.userId) => services.zero.run(name, args, userId);

  const definition = (ownerRole: string) => ({
    key: "ignored",
    version: 0,
    nodes: [
      { key: "start", name: "开始", completion: "auto", ownerRoles: [] },
      { key: "fix", name: "修复", completion: "singleConfirm", ownerRoles: [ownerRole], position: { x: 200, y: 0 } },
      {
        key: "verify",
        name: "验证",
        completion: "singleConfirm",
        ownerRoles: ["qa"],
        visibility: { kind: "equal", field: "needQa", value: "是" },
        stageOnArrival: "验证中",
      },
    ],
    edges: [
      { from: "start", to: "fix" },
      { from: "fix", to: "verify" },
    ],
  });

  beforeAll(async () => {
    admin = await signUp(`cfg-admin-${spaceId}@example.com`);
    member = await signUp(`cfg-member-${spaceId}@example.com`);
    await run("space.create", { id: spaceId, name: "配置" });
    await services.database.db.insert(schema.spaceMember).values({ spaceId, userId: member.userId });
  });

  it("only lets space admins change configuration", async () => {
    await expect(
      run("workItemType.create", { id: typeId, spaceId, key: "bug", name: "缺陷" }, member.userId),
    ).rejects.toThrow("空间管理员");
  });

  it("creates a type with roles, fields and a template that starts as a draft", async () => {
    await run("workItemType.create", { id: typeId, spaceId, key: "bug", name: "缺陷" });
    await run("roleDef.create", { id: `${typeId}/role/dev`, typeId, key: "dev", name: "开发" });
    await run("roleDef.create", { id: `${typeId}/role/qa`, typeId, key: "qa", name: "测试" });
    await run("fieldDef.create", {
      id: `${typeId}/field/needQa`,
      typeId,
      key: "needQa",
      name: "需要测试",
      dataType: "select",
      options: [
        { value: "是", label: "是" },
        { value: "否", label: "否" },
      ],
    });
    await run("flowTemplate.create", { id: templateId, typeId, key: "default", name: "默认流程" });

    const versions = await services.database.db
      .select()
      .from(schema.flowVersion)
      .where(eq(schema.flowVersion.templateId, templateId));
    expect(versions).toHaveLength(1);
    expect(versions[0]).toMatchObject({ version: 1, publishedAt: null });
  });

  it("refuses to publish a draft that references a missing role", async () => {
    await run("flowTemplate.saveDraft", { templateId, definition: definition("pm") });
    await expect(run("flowTemplate.publish", { versionId: `${templateId}/v1` })).rejects.toThrow(
      "负责角色「pm」不存在",
    );
  });

  it("publishes a valid draft, and work items use it", async () => {
    await run("flowTemplate.saveDraft", { templateId, definition: definition("dev") });
    await run("flowTemplate.publish", { versionId: `${templateId}/v1` });
    const [template] = await services.database.db
      .select()
      .from(schema.flowTemplate)
      .where(eq(schema.flowTemplate.id, templateId));
    expect(template?.currentVersionId).toBe(`${templateId}/v1`);

    const id = randomUUID();
    await run("workItem.create", {
      id,
      typeId,
      name: "登录报错",
      fields: { needQa: "否" },
      // 没给成员的角色默认是创建者；这里让测试角色留空
      roles: { dev: [member.userId], qa: [] },
    });
    const nodes = await services.database.db
      .select()
      .from(schema.nodeInstance)
      .where(eq(schema.nodeInstance.workItemId, id));
    const state = Object.fromEntries(nodes.map((n) => [n.nodeKey, [n.state, n.owners]]));
    expect(state).toEqual({
      start: ["completed", []],
      fix: ["inProgress", [member.userId]],
      verify: ["skipped", []],
    });
  });

  it("editing a published template opens a new draft and leaves the published version alone", async () => {
    await run("flowTemplate.saveDraft", { templateId, definition: definition("qa") });
    const versions = await services.database.db
      .select()
      .from(schema.flowVersion)
      .where(eq(schema.flowVersion.templateId, templateId))
      .orderBy(schema.flowVersion.version);
    expect(
      versions.map((v) => [v.version, v.publishedAt !== null, (v.definition as FlowDefinition).nodes[1]?.ownerRoles]),
    ).toEqual([
      [1, true, ["dev"]],
      [2, false, ["qa"]],
    ]);
    await expect(run("flowTemplate.publish", { versionId: `${templateId}/v1` })).rejects.toThrow("已经发布过");
  });
});

describe("automation rules", () => {
  const spaceId = randomUUID();
  let admin: { cookie: string; userId: string };
  let member: { cookie: string; userId: string };
  let typeId: string;
  const { F } = demoSample;

  beforeAll(async () => {
    admin = await signUp(`auto-admin-${spaceId}@example.com`);
    member = await signUp(`auto-member-${spaceId}@example.com`);
    await services.zero.run("space.create", { id: spaceId, name: "自动化" }, admin.userId);
    await services.database.db.insert(schema.spaceMember).values({ spaceId, userId: member.userId });
    ({ typeId } = await importDemoTemplate(services.database.db, spaceId));
  });

  async function createItem() {
    const id = randomUUID();
    await services.zero.run(
      "workItem.create",
      { id, typeId, name: "新品 X", fields: { [F.needPhaseOut]: "是" }, roles: {} },
      admin.userId,
    );
    return id;
  }
  const eventsOf = (workItemId: string) =>
    services.database.db
      .select()
      .from(schema.eventLog)
      .where(eq(schema.eventLog.workItemId, workItemId))
      .orderBy(schema.eventLog.id);
  const runsOf = (ruleId: string) =>
    services.database.db.select().from(schema.automationRun).where(eq(schema.automationRun.ruleId, ruleId));

  it("only lets space admins manage rules", async () => {
    const rule = {
      id: randomUUID(),
      spaceId,
      name: "x",
      trigger: { kind: "workItemCreated" },
      actions: [{ type: "setField", field: F.linkedModel, value: "A" }],
    };
    await expect(services.zero.run("automation.create", rule, member.userId)).rejects.toThrow("管理员");
    await expect(services.zero.run("automation.create", { ...rule, actions: [] }, admin.userId)).rejects.toThrow(
      "至少要有一个动作",
    );
  });

  it("runs a matching rule once, as its creator, and its own writes do not trigger rules again", async () => {
    const ruleId = randomUUID();
    await services.zero.run(
      "automation.create",
      {
        id: ruleId,
        spaceId,
        name: "立项提案开始时填 SKU",
        trigger: { kind: "nodeStarted", typeId, node: "doing" },
        condition: { kind: "equal", field: F.needPhaseOut, value: "是" },
        actions: [{ type: "setField", field: F.linkedModel, value: "SKU-AUTO" }],
      },
      admin.userId,
    );
    const id = await createItem();
    const started = (await eventsOf(id)).find((e) => e.kind === "nodeStarted" && e.payload.node === "doing");
    if (!started) throw new Error("没有 nodeStarted 事件");
    // 其他事件（比如 workItemCreated）不触发这条规则
    const created = (await eventsOf(id)).find((e) => e.kind === "workItemCreated");
    expect(await matchRules(services.database, created?.id as number)).not.toContain(ruleId);
    expect(await matchRules(services.database, started.id)).toEqual([ruleId]);

    const runner = createMutatorRunner(services.database);
    expect(await runRule(runner, ruleId, started.id, "wf-1")).toBe("succeeded");
    const [value] = await services.database.db
      .select()
      .from(schema.fieldValue)
      .where(and(eq(schema.fieldValue.workItemId, id), eq(schema.fieldValue.fieldKey, F.linkedModel)));
    expect(value?.value).toBe("SKU-AUTO");

    const changed = (await eventsOf(id)).at(-1);
    expect(changed).toMatchObject({ kind: "fieldChanged", actor: admin.userId, causedBy: started.id });
    expect(await matchRules(services.database, changed?.id as number)).toEqual([]);

    // 重试不会重复执行
    expect(await runRule(runner, ruleId, started.id, "wf-1")).toBe("succeeded");
    expect(await runsOf(ruleId)).toHaveLength(1);
    expect((await eventsOf(id)).filter((e) => e.kind === "fieldChanged")).toHaveLength(1);

    // 停用后不再匹配
    await services.zero.run(
      "automation.update",
      {
        id: ruleId,
        name: "立项提案开始时填 SKU",
        enabled: false,
        trigger: { kind: "nodeStarted", typeId, node: "doing" },
        actions: [{ type: "setField", field: F.linkedModel, value: "SKU-AUTO" }],
      },
      admin.userId,
    );
    expect(await matchRules(services.database, started.id)).toEqual([]);
  });

  it("records a failed run and rolls back every action when one is refused", async () => {
    const ruleId = randomUUID();
    await services.zero.run(
      "automation.create",
      {
        id: ruleId,
        spaceId,
        name: "创建后填 SKU 并完成财务分析",
        trigger: { kind: "workItemCreated" },
        actions: [
          { type: "setField", field: F.linkedModel, value: "SKU-ROLLBACK" },
          { type: "confirmNode", node: "state_51" },
        ],
      },
      admin.userId,
    );
    const id = await createItem();
    const created = (await eventsOf(id)).find((e) => e.kind === "workItemCreated");
    expect(await matchRules(services.database, created?.id as number)).toContain(ruleId);
    const runner = createMutatorRunner(services.database);
    expect(await runRule(runner, ruleId, created?.id as number, "wf-2")).toBe("failed");
    const [run] = await runsOf(ruleId);
    expect(run).toMatchObject({ status: "failed", workflowId: "wf-2" });
    expect(run?.error).toBeTruthy();
    const values = await services.database.db
      .select()
      .from(schema.fieldValue)
      .where(and(eq(schema.fieldValue.workItemId, id), eq(schema.fieldValue.fieldKey, F.linkedModel)));
    expect(values).toEqual([]);

    await services.zero.run("automation.delete", { id: ruleId }, admin.userId);
    expect(await runsOf(ruleId)).toEqual([]);
  });

  it("reacts to a comment by notifying, commenting, adding a task and creating a related work item", async () => {
    const relationDefId = randomUUID();
    await services.zero.run(
      "relationDef.create",
      { id: relationDefId, fromTypeId: typeId, toTypeId: typeId, name: "跟进项", cardinality: "many" },
      admin.userId,
    );
    const id = await createItem();
    const [role] = await services.database.db
      .select()
      .from(schema.roleMember)
      .where(eq(schema.roleMember.workItemId, id));
    if (!role) throw new Error("工作项没有角色成员");
    const ruleId = randomUUID();
    await services.zero.run(
      "automation.create",
      {
        id: ruleId,
        spaceId,
        name: "评论后跟进",
        trigger: { kind: "commentAdded", typeId },
        actions: [
          { type: "notify", to: [`role:${role.roleKey}`, `user:${member.userId}`], text: "「{{name}}」有新评论" },
          { type: "addComment", body: "已收到，跟进中" },
          { type: "createTask", node: "doing", name: "回复「{{name}}」的评论", assigneeId: member.userId },
          { type: "createWorkItem", typeId, name: "{{name}} 的跟进", relationDefId },
        ],
      },
      admin.userId,
    );
    await services.zero.run(
      "comment.create",
      { id: randomUUID(), workItemId: id, body: "什么时候能好？", mentions: [] },
      member.userId,
    );
    const commented = (await eventsOf(id)).find((e) => e.kind === "commentAdded");
    if (!commented) throw new Error("没有 commentAdded 事件");
    expect(await matchRules(services.database, commented.id)).toEqual([ruleId]);
    const runner = createMutatorRunner(services.database);
    expect(await runRule(runner, ruleId, commented.id, "wf-3")).toBe("succeeded");
    expect((await runsOf(ruleId))[0]?.error ?? null).toBeNull();

    // 角色成员（管理员）收到通知；评论的人自己没选「触发人」，不收
    const notes = await services.database.db
      .select()
      .from(schema.notification)
      .where(and(eq(schema.notification.workItemId, id), eq(schema.notification.kind, "automation")));
    expect(notes.map((n) => [n.userId, n.text])).toEqual([[admin.userId, "「新品 X」有新评论"]]);

    const comments = await services.database.db.select().from(schema.comment).where(eq(schema.comment.workItemId, id));
    expect(comments.map((c) => c.body).sort()).toEqual(["什么时候能好？", "已收到，跟进中"].sort());
    const tasks = await services.database.db.select().from(schema.nodeTask).where(eq(schema.nodeTask.workItemId, id));
    expect(tasks.map((t) => [t.name, t.nodeKey, t.assigneeId])).toEqual([
      ["回复「新品 X」的评论", "doing", member.userId],
    ]);
    const [link] = await services.database.db
      .select()
      .from(schema.relation)
      .where(and(eq(schema.relation.fromId, id), eq(schema.relation.relationDefId, relationDefId)));
    const [followUp] = await services.database.db
      .select()
      .from(schema.workItem)
      .where(eq(schema.workItem.id, link?.toId as string));
    expect(followUp?.name).toBe("新品 X 的跟进");

    // 自动化自己的评论不再触发规则；重试不会重复
    const ownComment = (await eventsOf(id)).filter((e) => e.kind === "commentAdded").at(-1);
    expect(ownComment?.causedBy).toBe(commented.id);
    expect(await matchRules(services.database, ownComment?.id as number)).toEqual([]);
    expect(await runRule(runner, ruleId, commented.id, "wf-3")).toBe("succeeded");
    expect(await runsOf(ruleId)).toHaveLength(1);
    await services.zero.run("automation.delete", { id: ruleId }, admin.userId);
  });

  it("matches status, role and termination triggers with their filters", async () => {
    const ruleId = randomUUID();
    await services.zero.run(
      "automation.create",
      {
        id: ruleId,
        spaceId,
        name: "终止后恢复",
        trigger: { kind: "workItemTerminated", typeId },
        actions: [{ type: "restore" }],
      },
      admin.userId,
    );
    const id = await createItem();
    await services.zero.run("workItem.terminate", { workItemId: id, reason: "误操作" }, admin.userId);
    const terminated = (await eventsOf(id)).find((e) => e.kind === "workItemTerminated");
    expect(await matchRules(services.database, terminated?.id as number)).toEqual([ruleId]);
    expect(await runRule(createMutatorRunner(services.database), ruleId, terminated?.id as number, "wf-4")).toBe(
      "succeeded",
    );
    const [item] = await services.database.db.select().from(schema.workItem).where(eq(schema.workItem.id, id));
    expect(item?.status).not.toBe("terminated");
    await services.zero.run("automation.delete", { id: ruleId }, admin.userId);

    await expect(
      services.zero.run(
        "automation.create",
        {
          id: randomUUID(),
          spaceId,
          name: "x",
          trigger: { kind: "workItemCreated" },
          actions: [{ type: "notify", to: [], text: "x" }],
        },
        admin.userId,
      ),
    ).rejects.toThrow("收件人");
  });
});

describe("timed automation and branches", () => {
  const spaceId = randomUUID();
  let admin: { cookie: string; userId: string };
  let typeId: string;
  const { F } = demoSample;
  // 2020-01-07 09:00（上海）。固定在过去：新建工作项的节点默认排期从今天算，
  // 如果时钟用的日子贴近今天，别的工作项的默认计划完成日会碰巧命中到期规则。
  const nine = Date.parse("2020-01-07T01:00:00Z");

  beforeAll(async () => {
    admin = await signUp(`timed-${spaceId}@example.com`);
    await services.zero.run("space.create", { id: spaceId, name: "定时" }, admin.userId);
    ({ typeId } = await importDemoTemplate(services.database.db, spaceId));
  });

  async function createItem(name: string, phaseOut = "是") {
    const id = randomUUID();
    await services.zero.run(
      "workItem.create",
      { id, typeId, name, fields: { [F.needPhaseOut]: phaseOut }, roles: {} },
      admin.userId,
    );
    return id;
  }
  const clockEvents = (workItemId: string, kind: string) =>
    services.database.db
      .select()
      .from(schema.eventLog)
      .where(and(eq(schema.eventLog.workItemId, workItemId), eq(schema.eventLog.kind, kind)));
  const commentsOf = (workItemId: string) =>
    services.database.db.select().from(schema.comment).where(eq(schema.comment.workItemId, workItemId));

  it("fires a daily schedule once per item at the chosen local hour, with branches by condition", async () => {
    const a = await createItem("新品 A", "是");
    const b = await createItem("新品 B", "否");
    const ruleId = randomUUID();
    await services.zero.run(
      "automation.create",
      {
        id: ruleId,
        spaceId,
        name: "每天 9 点提醒",
        trigger: { kind: "schedule", typeId, frequency: "day", hour: 9 },
        condition: { kind: "equal", field: F.needPhaseOut, value: "是" },
        actions: [{ type: "addComment", body: "记得评估下市风险" }],
        branches: [{ condition: null, actions: [{ type: "addComment", body: "今天也要推进" }] }],
      },
      admin.userId,
    );
    await expect(
      services.zero.run(
        "automation.create",
        {
          id: randomUUID(),
          spaceId,
          name: "x",
          trigger: { kind: "schedule", typeId, frequency: "week", weekdays: [], hour: 9 },
          actions: [{ type: "restore" }],
        },
        admin.userId,
      ),
    ).rejects.toThrow("至少要选一天");

    // 8 点不触发；9 点每个工作项一条；同一个整点再调一次不重复
    expect(await tickAutomations(services.database, nine - 3_600_000)).toBe(0);
    expect(await tickAutomations(services.database, nine)).toBe(2);
    expect(await tickAutomations(services.database, nine + 5)).toBe(0);

    const runner = createMutatorRunner(services.database);
    for (const [id, body] of [
      [a, "记得评估下市风险"],
      [b, "今天也要推进"],
    ] as const) {
      const [event] = await clockEvents(id, "schedule");
      if (!event) throw new Error("没有定时事件");
      expect(event.payload).toEqual({ ruleId, slot: nine });
      expect(await matchRules(services.database, event.id)).toEqual([ruleId]);
      expect(await runRule(runner, ruleId, event.id, "wf-clock")).toBe("succeeded");
      expect((await commentsOf(id)).map((c) => c.body)).toEqual([body]);
    }

    // 去掉兜底分支后，不满足条件的工作项不匹配；规则停用后时钟不再触发
    await services.zero.run(
      "automation.update",
      {
        id: ruleId,
        name: "每天 9 点提醒",
        enabled: false,
        trigger: { kind: "schedule", typeId, frequency: "day", hour: 9 },
        condition: { kind: "equal", field: F.needPhaseOut, value: "是" },
        actions: [{ type: "addComment", body: "记得评估下市风险" }],
      },
      admin.userId,
    );
    const [bEvent] = await clockEvents(b, "schedule");
    expect(await matchRules(services.database, bEvent?.id as number)).toEqual([]);
    expect(await tickAutomations(services.database, nine + 86_400_000)).toBe(0);
  });

  it("fires a due-soon trigger on a node's planned end and skips items whose branch no longer applies", async () => {
    const id = await createItem("新品 C");
    const other = await createItem("新品 D");
    await services.zero.run(
      "node.setPlan",
      { workItemId: id, nodeKey: "doing", start: "2020-01-05", end: "2020-01-08" },
      admin.userId,
    );
    await services.zero.run(
      "node.setPlan",
      { workItemId: other, nodeKey: "doing", start: "2020-01-05", end: "2020-01-10" },
      admin.userId,
    );
    const ruleId = randomUUID();
    await services.zero.run(
      "automation.create",
      {
        id: ruleId,
        spaceId,
        name: "节点到期前一天提醒",
        trigger: { kind: "dateReached", typeId, date: "node:doing", when: "before", days: 1, hour: 9 },
        condition: { kind: "equal", field: F.needPhaseOut, value: "是" },
        actions: [{ type: "notify", to: ["creator"], text: "「{{name}}」明天到期" }],
      },
      admin.userId,
    );
    expect(await tickAutomations(services.database, nine)).toBe(1);
    const [event] = await clockEvents(id, "dateReached");
    expect(event?.payload).toEqual({ ruleId, slot: nine });
    expect(await clockEvents(other, "dateReached")).toEqual([]);

    // 执行前条件变了：没有分支可走，记为跳过
    await services.zero.run("fieldValue.set", { workItemId: id, fieldKey: F.needPhaseOut, value: "否" }, admin.userId);
    expect(await runRule(createMutatorRunner(services.database), ruleId, event?.id as number, "wf-due")).toBe(
      "skipped",
    );
    const [run] = await services.database.db
      .select()
      .from(schema.automationRun)
      .where(eq(schema.automationRun.ruleId, ruleId));
    expect(run?.status).toBe("skipped");
  });
});

describe("saved views", () => {
  const spaceId = randomUUID();
  let admin: { cookie: string; userId: string };
  let member: { cookie: string; userId: string };

  beforeAll(async () => {
    admin = await signUp(`view-admin-${spaceId}@example.com`);
    member = await signUp(`view-member-${spaceId}@example.com`);
    await services.zero.run("space.create", { id: spaceId, name: "视图" }, admin.userId);
    await services.database.db.insert(schema.spaceMember).values({ spaceId, userId: member.userId });
  });

  const viewsOf = () =>
    services.database.db.select().from(schema.savedView).where(eq(schema.savedView.spaceId, spaceId));

  it("lets members save views with only the conditions that have values", async () => {
    const id = randomUUID();
    await services.zero.run(
      "view.create",
      { id, spaceId, name: "进行中", filter: { statuses: ["inProgress"], typeIds: [] } },
      member.userId,
    );
    expect(await viewsOf()).toMatchObject([{ id, name: "进行中", filter: { statuses: ["inProgress"] } }]);
    expect((await viewsOf())[0]?.filter).not.toHaveProperty("typeIds");
  });

  it("refuses outsiders, and only the creator or an admin can delete", async () => {
    const outsider = await signUp(`view-outsider-${randomUUID()}@example.com`);
    await expect(
      services.zero.run("view.create", { id: randomUUID(), spaceId, name: "x", filter: {} }, outsider.userId),
    ).rejects.toThrow("不是空间成员");

    const id = randomUUID();
    await services.zero.run("view.create", { id, spaceId, name: "管理员的", filter: {} }, admin.userId);
    await expect(services.zero.run("view.delete", { id }, member.userId)).rejects.toThrow("创建人或空间管理员");
    const [mine] = await viewsOf();
    await services.zero.run("view.delete", { id: mine?.id as string }, admin.userId);
    await services.zero.run("view.delete", { id }, admin.userId);
    expect(await viewsOf()).toEqual([]);
  });
});

describe("comments and notifications", () => {
  const spaceId = randomUUID();
  let admin: { cookie: string; userId: string };
  let member: { cookie: string; userId: string };
  let itemId: string;
  const { F } = demoSample;

  beforeAll(async () => {
    admin = await signUp(`note-admin-${spaceId}@example.com`);
    member = await signUp(`note-member-${spaceId}@example.com`);
    await services.zero.run("space.create", { id: spaceId, name: "通知" }, admin.userId);
    await services.database.db.insert(schema.spaceMember).values({ spaceId, userId: member.userId });
    const { typeId } = await importDemoTemplate(services.database.db, spaceId);
    itemId = randomUUID();
    await services.zero.run(
      "workItem.create",
      { id: itemId, typeId, name: "新品 N", fields: { [F.needPhaseOut]: "是" }, roles: { NPD: [member.userId] } },
      admin.userId,
    );
  });

  const eventsOf = () =>
    services.database.db
      .select()
      .from(schema.eventLog)
      .where(eq(schema.eventLog.workItemId, itemId))
      .orderBy(schema.eventLog.id);
  const inbox = (userId: string) =>
    services.database.db.select().from(schema.notification).where(eq(schema.notification.userId, userId));

  it("tells a node's owners when it starts", async () => {
    const started = (await eventsOf()).find((e) => e.kind === "nodeStarted" && e.payload.node === "doing");
    expect(await notify(services.database, started?.id as number)).toBeGreaterThan(0);
    expect(await inbox(member.userId)).toMatchObject([
      { kind: "nodeAssigned", workItemId: itemId, text: "「新品 N」的节点「立项提案」轮到你了", readAt: null },
    ]);
  });

  it("posts a comment, notifies the people it mentions once, and only space members can be mentioned", async () => {
    const outsider = await signUp(`note-outsider-${randomUUID()}@example.com`);
    await expect(
      services.zero.run(
        "comment.create",
        { id: randomUUID(), workItemId: itemId, body: "看一下", mentions: [outsider.userId] },
        admin.userId,
      ),
    ).rejects.toThrow("只能提及空间成员");
    await expect(
      services.zero.run(
        "comment.create",
        { id: randomUUID(), workItemId: itemId, body: "x", mentions: [] },
        outsider.userId,
      ),
    ).rejects.toThrow("没有权限");

    const id = randomUUID();
    await services.zero.run(
      "comment.create",
      { id, workItemId: itemId, body: "@成员 看一下配方", mentions: [member.userId, admin.userId] },
      admin.userId,
    );
    const [saved] = await services.database.db.select().from(schema.comment).where(eq(schema.comment.id, id));
    expect(saved).toMatchObject({ authorId: admin.userId, mentions: [member.userId] });
    const event = (await eventsOf()).at(-1);
    expect(event).toMatchObject({ kind: "commentAdded", payload: { commentId: id, mentions: [member.userId] } });

    await notify(services.database, event?.id as number);
    await notify(services.database, event?.id as number);
    const mentioned = (await inbox(member.userId)).filter((n) => n.kind === "mentioned");
    expect(mentioned).toHaveLength(1);
    expect(mentioned[0]?.text).toContain("评论里提到了你");
    // 评论人提到自己不发通知（角色默认是创建者，管理员可能另有节点通知）
    expect((await inbox(admin.userId)).filter((n) => n.kind === "mentioned")).toEqual([]);
  });

  it("replies in a thread, edits and deletes comments", async () => {
    const root = randomUUID();
    await services.zero.run(
      "comment.create",
      { id: root, workItemId: itemId, body: "先定配方", mentions: [] },
      admin.userId,
    );
    // 成员回复管理员：回复挂在一级评论下，管理员收到「回复了你的评论」
    const reply = randomUUID();
    await services.zero.run(
      "comment.create",
      { id: reply, workItemId: itemId, body: "好的", mentions: [], replyTo: root },
      member.userId,
    );
    // 管理员回复楼里的回复：仍挂在一级评论下，回复对象是成员
    const answer = randomUUID();
    await services.zero.run(
      "comment.create",
      { id: answer, workItemId: itemId, body: "周五前", mentions: [], replyTo: reply },
      admin.userId,
    );
    const rows = await services.database.db.select().from(schema.comment).where(eq(schema.comment.workItemId, itemId));
    const byId = new Map(rows.map((r) => [r.id, r]));
    expect(byId.get(reply)).toMatchObject({ parentId: root, replyToId: admin.userId });
    expect(byId.get(answer)).toMatchObject({ parentId: root, replyToId: member.userId });
    const replied = (await eventsOf()).filter((e) => e.kind === "commentAdded" && e.payload.parentId === root);
    for (const e of replied) await notify(services.database, e.id);
    expect((await inbox(admin.userId)).filter((n) => n.kind === "replied").map((n) => n.text)).toEqual([
      expect.stringContaining("在「新品 N」回复了你的评论"),
    ]);
    expect((await inbox(member.userId)).filter((n) => n.kind === "replied")).toHaveLength(1);

    // 只能编辑自己的评论；编辑后新提及的人收到通知
    await expect(
      services.zero.run("comment.update", { id: root, body: "改", mentions: [] }, member.userId),
    ).rejects.toThrow("只能编辑自己的评论");
    await services.zero.run(
      "comment.update",
      { id: root, body: "先定配方 A", mentions: [member.userId] },
      admin.userId,
    );
    const [edited] = await services.database.db.select().from(schema.comment).where(eq(schema.comment.id, root));
    expect(edited).toMatchObject({ body: "先定配方 A", mentions: [member.userId] });
    expect(edited?.editedAt).not.toBeNull();
    const editEvent = (await eventsOf()).at(-1);
    expect(editEvent).toMatchObject({ kind: "commentEdited", payload: { commentId: root, mentions: [member.userId] } });

    // 成员不能删别人的评论；管理员能删任何评论；删除后内容清空、回复保留
    await expect(services.zero.run("comment.delete", { id: root }, member.userId)).rejects.toThrow(
      "只能删除自己的评论",
    );
    await services.zero.run("comment.delete", { id: reply }, admin.userId);
    await services.zero.run("comment.delete", { id: root }, admin.userId);
    const [gone] = await services.database.db.select().from(schema.comment).where(eq(schema.comment.id, root));
    expect(gone).toMatchObject({ body: "", mentions: [] });
    expect(gone?.deletedAt).not.toBeNull();
    await expect(
      services.zero.run(
        "comment.create",
        { id: randomUUID(), workItemId: itemId, body: "x", mentions: [], replyTo: root },
        member.userId,
      ),
    ).rejects.toThrow("评论已删除");
    expect((await eventsOf()).at(-1)).toMatchObject({ kind: "commentDeleted", payload: { commentId: root } });
  });

  it("nudges a node's owners once per ten minutes", async () => {
    await expect(
      services.zero.run("node.nudge", { workItemId: itemId, nodeKey: "state_51" }, admin.userId),
    ).rejects.toThrow("只能催进行中的节点");

    await services.zero.run("node.nudge", { workItemId: itemId, nodeKey: "doing" }, admin.userId);
    const event = (await eventsOf()).at(-1);
    expect(event).toMatchObject({ kind: "nodeNudged", actor: admin.userId, payload: { node: "doing" } });
    // 只提醒其他负责人，不提醒催的人自己
    const to = (event?.payload as { to: string[] }).to;
    expect(to).toContain(member.userId);
    expect(to).not.toContain(admin.userId);
    await notify(services.database, event?.id as number);
    expect((await inbox(member.userId)).filter((n) => n.kind === "nudge").map((n) => n.text)).toEqual([
      expect.stringContaining("催你处理「新品 N」的节点「立项提案」"),
    ]);
    await expect(
      services.zero.run("node.nudge", { workItemId: itemId, nodeKey: "doing" }, admin.userId),
    ).rejects.toThrow("10 分钟内已经催过了");
  });

  it("marks only your own notifications read", async () => {
    const ids = (await inbox(member.userId)).map((n) => n.id);
    await services.zero.run("notification.markRead", { ids }, admin.userId);
    expect((await inbox(member.userId)).every((n) => n.readAt === null)).toBe(true);
    await services.zero.run("notification.markRead", { ids }, member.userId);
    expect((await inbox(member.userId)).every((n) => n.readAt !== null)).toBe(true);
  });
});

describe("sub-items driving a node", () => {
  const spaceId = randomUUID();
  let admin: { cookie: string; userId: string };
  let member: { cookie: string; userId: string };
  const run = (name: string, args: unknown, userId = admin.userId) => services.zero.run(name, args, userId);
  const projectType = `${spaceId}/project`;
  const taskType = `${spaceId}/task`;
  const parentId = randomUUID();

  async function defineType(typeId: string, key: string, name: string, nodes: unknown[], edges: unknown[]) {
    await run("workItemType.create", { id: typeId, spaceId, key, name });
    await run("roleDef.create", { id: `${typeId}/role/owner`, typeId, key: "owner", name: "负责人" });
    await run("flowTemplate.create", { id: `${typeId}/default`, typeId, key: "default", name: "默认流程" });
    await run("flowTemplate.saveDraft", {
      templateId: `${typeId}/default`,
      definition: { key, version: 0, nodes, edges },
    });
    await run("flowTemplate.publish", { versionId: `${typeId}/default/v1` });
  }
  const nodeState = async (workItemId: string, nodeKey: string) =>
    (
      await services.database.db
        .select()
        .from(schema.nodeInstance)
        .where(and(eq(schema.nodeInstance.workItemId, workItemId), eq(schema.nodeInstance.nodeKey, nodeKey)))
    )[0]?.state;
  /** worker 收到子工作项完成事件时做的事。 */
  async function cascade(childId: string) {
    const events = await services.database.db
      .select()
      .from(schema.eventLog)
      .where(and(eq(schema.eventLog.workItemId, childId), eq(schema.eventLog.kind, "workItemCompleted")));
    const runner = createMutatorRunner(services.database);
    for (const e of events) await cascadeSubItems(runner, e.id);
  }

  beforeAll(async () => {
    admin = await signUp(`sub-admin-${spaceId}@example.com`);
    member = await signUp(`sub-member-${spaceId}@example.com`);
    await run("space.create", { id: spaceId, name: "子工作项" });
    await services.database.db.insert(schema.spaceMember).values({ spaceId, userId: member.userId });
    await defineType(
      projectType,
      "project",
      "项目",
      [
        { key: "start", name: "开始", completion: "auto", ownerRoles: [] },
        { key: "build", name: "开发", completion: "subItemDriven", ownerRoles: ["owner"] },
        { key: "accept", name: "验收", completion: "singleConfirm", ownerRoles: ["owner"] },
      ],
      [
        { from: "start", to: "build" },
        { from: "build", to: "accept" },
      ],
    );
    await defineType(
      taskType,
      "task",
      "任务",
      [
        { key: "start", name: "开始", completion: "auto", ownerRoles: [] },
        { key: "work", name: "处理", completion: "singleConfirm", ownerRoles: ["owner"] },
      ],
      [{ from: "start", to: "work" }],
    );
    await run("workItem.create", {
      id: parentId,
      typeId: projectType,
      name: "官网改版",
      fields: {},
      roles: { owner: [member.userId] },
    });
  });

  it("only creates sub-items under an in-progress sub-item-driven node", async () => {
    await expect(
      run("workItem.createSubItem", { id: randomUUID(), parentId, nodeKey: "accept", typeId: taskType, name: "x" }),
    ).rejects.toThrow("不是由子工作项驱动");
    const outsider = await signUp(`sub-outsider-${randomUUID()}@example.com`);
    await expect(
      run(
        "workItem.createSubItem",
        { id: randomUUID(), parentId, nodeKey: "build", typeId: taskType, name: "x" },
        outsider.userId,
      ),
    ).rejects.toThrow("没有权限");
    // 子工作项驱动的节点，负责人不能手动确认
    await expect(run("node.confirm", { workItemId: parentId, nodeKey: "build" }, member.userId)).rejects.toThrow(
      "只有超管可以手动完成",
    );
  });

  it("completes the parent node once every sub-item is done, and then starts the next node", async () => {
    const [a, b] = [randomUUID(), randomUUID()];
    await run("workItem.createSubItem", { id: a, parentId, nodeKey: "build", typeId: taskType, name: "首页" });
    await run("workItem.createSubItem", { id: b, parentId, nodeKey: "build", typeId: taskType, name: "详情页" });

    const relations = await services.database.db
      .select()
      .from(schema.relation)
      .where(eq(schema.relation.fromId, parentId));
    expect(relations.map((r) => [r.toId, r.parentNodeKey, r.relationDefId]).sort()).toEqual(
      [
        [a, "build", null],
        [b, "build", null],
      ].sort(),
    );
    // 子工作项的角色默认是父节点的负责人
    const [owners] = await services.database.db
      .select()
      .from(schema.nodeInstance)
      .where(and(eq(schema.nodeInstance.workItemId, a), eq(schema.nodeInstance.nodeKey, "work")));
    expect(owners?.owners).toEqual([member.userId]);
    const created = await services.database.db
      .select()
      .from(schema.eventLog)
      .where(and(eq(schema.eventLog.workItemId, parentId), eq(schema.eventLog.kind, "subItemCreated")));
    expect(created).toHaveLength(2);

    await run("node.confirm", { workItemId: a, nodeKey: "work" }, member.userId);
    await cascade(a);
    expect(await nodeState(parentId, "build")).toBe("inProgress");

    await run("node.confirm", { workItemId: b, nodeKey: "work" }, member.userId);
    await cascade(b);
    await cascade(b); // 重试不会出错，也不会重复推进
    expect(await nodeState(parentId, "build")).toBe("completed");
    expect(await nodeState(parentId, "accept")).toBe("inProgress");
    const completed = await services.database.db
      .select()
      .from(schema.eventLog)
      .where(and(eq(schema.eventLog.workItemId, parentId), eq(schema.eventLog.kind, "nodeCompleted")));
    expect(completed.filter((e) => e.payload.node === "build")).toHaveLength(1);

    await expect(
      run("workItem.createSubItem", { id: randomUUID(), parentId, nodeKey: "build", typeId: taskType, name: "x" }),
    ).rejects.toThrow("不在进行中");
  });
});

describe("node dependencies added on a work item", () => {
  const spaceId = randomUUID();
  const typeId = `${spaceId}/project`;
  let admin: { cookie: string; userId: string };
  let owner: { cookie: string; userId: string };
  let other: { cookie: string; userId: string };
  const run = (name: string, args: unknown, userId = admin.userId) => services.zero.run(name, args, userId);

  beforeAll(async () => {
    admin = await signUp(`dep-admin-${spaceId}@example.com`);
    owner = await signUp(`dep-owner-${spaceId}@example.com`);
    other = await signUp(`dep-other-${spaceId}@example.com`);
    await run("space.create", { id: spaceId, name: "依赖" });
    await services.database.db.insert(schema.spaceMember).values([
      { spaceId, userId: owner.userId },
      { spaceId, userId: other.userId },
    ]);
    await run("workItemType.create", { id: typeId, spaceId, key: "project", name: "项目" });
    await run("roleDef.create", { id: `${typeId}/role/owner`, typeId, key: "owner", name: "负责人" });
    await run("flowTemplate.create", { id: `${typeId}/default`, typeId, key: "default", name: "默认流程" });
    const step = (key: string, name: string) => ({ key, name, completion: "singleConfirm", ownerRoles: ["owner"] });
    await run("flowTemplate.saveDraft", {
      templateId: `${typeId}/default`,
      definition: {
        key: "project",
        version: 0,
        nodes: [
          { key: "start", name: "开始", completion: "auto", ownerRoles: [] },
          step("design", "设计"),
          step("buy", "采购"),
          step("ship", "发货"),
        ],
        edges: [
          { from: "start", to: "design" },
          { from: "start", to: "buy" },
          { from: "design", to: "ship" },
          { from: "buy", to: "ship" },
        ],
      },
    });
    await run("flowTemplate.publish", { versionId: `${typeId}/default/v1` });
  });

  async function create(name: string) {
    const id = randomUUID();
    await run("workItem.create", { id, typeId, name, fields: {}, roles: { owner: [owner.userId] } });
    return id;
  }
  const state = async (workItemId: string, nodeKey: string) =>
    (
      await services.database.db
        .select()
        .from(schema.nodeInstance)
        .where(and(eq(schema.nodeInstance.workItemId, workItemId), eq(schema.nodeInstance.nodeKey, nodeKey)))
    )[0]?.state;
  const add = (
    from: [item: string, node: string],
    to: [item: string, node: string],
    allow: "start" | "complete",
    userId = owner.userId,
    id: string = randomUUID(),
  ) =>
    run(
      "dependency.add",
      { id, workItemId: from[0], nodeKey: from[1], targetItemId: to[0], targetNodeKey: to[1], allow },
      userId,
    );
  const confirm = (workItemId: string, nodeKey: string) => run("node.confirm", { workItemId, nodeKey }, owner.userId);
  /** worker 收到一个工作项的事件时做的事。 */
  async function cascade(workItemId: string) {
    const runner = createMutatorRunner(services.database);
    const events = await services.database.db
      .select()
      .from(schema.eventLog)
      .where(eq(schema.eventLog.workItemId, workItemId));
    for (const e of events) await cascadeDependencies(runner, e.id);
  }

  it("a node waits for a node in another work item until it completes", async () => {
    const a = await create("面霜");
    const b = await create("精华");
    // 面霜的设计要等精华的设计完成才能完成；面霜的发货要等精华的采购完成才能开始
    await add([a, "design"], [b, "design"], "complete");
    await add([a, "ship"], [b, "buy"], "start");
    await expect(add([a, "design"], [b, "design"], "complete")).rejects.toThrow(/已经有这条依赖/);
    await expect(add([b, "design"], [a, "design"], "complete")).rejects.toThrow(/互相等待/);
    await expect(add([a, "design"], [a, "ship"], "complete")).rejects.toThrow(/后面，等它会卡住/);
    await expect(add([a, "design"], [b, "buy"], "start")).rejects.toThrow(/已经开始了/);
    await expect(add([a, "design"], [a, "design"], "complete")).rejects.toThrow(/不能依赖自己/);

    await expect(confirm(a, "design")).rejects.toThrow("要等「精华 · 设计」完成才能完成");
    await confirm(b, "design");
    await confirm(a, "design");
    await confirm(a, "buy");
    // 前序都完成了，但精华的采购还没完成：发货等着
    expect(await state(a, "ship")).toBe("notStarted");
    await cascade(b);
    expect(await state(a, "ship")).toBe("notStarted");
    await confirm(b, "buy");
    await cascade(b);
    expect(await state(a, "ship")).toBe("inProgress");
    const events = await services.database.db.select().from(schema.eventLog).where(eq(schema.eventLog.workItemId, a));
    expect(events.filter((e) => e.kind === "dependencyAdded")).toHaveLength(2);
    expect(
      events.find((e) => e.kind === "nodeStarted" && (e.payload as { node: string }).node === "ship"),
    ).toBeTruthy();
  });

  it("stops waiting when the other work item is terminated", async () => {
    const a = await create("面霜");
    const b = await create("精华");
    await add([a, "design"], [b, "design"], "complete");
    await expect(confirm(a, "design")).rejects.toThrow(/要等/);
    await run("workItem.terminate", { workItemId: b, reason: "取消" });
    await confirm(a, "design");
    expect(await state(a, "design")).toBe("completed");
  });

  it("inside one work item: removing the dependency lets the node start; others can't change it", async () => {
    const a = await create("面霜");
    const id = randomUUID();
    await expect(add([a, "ship"], [a, "design"], "start", other.userId, id)).rejects.toThrow(/只有节点负责人/);
    // 采购要等设计完成才能完成（两个并行节点之间）
    await add([a, "buy"], [a, "design"], "complete", owner.userId, id);
    await expect(confirm(a, "buy")).rejects.toThrow("要等「设计」完成才能完成");
    await expect(run("dependency.remove", { id }, other.userId)).rejects.toThrow(/只有节点负责人/);
    await run("dependency.remove", { id }, owner.userId);
    await confirm(a, "buy");
    expect(await state(a, "buy")).toBe("completed");
    const kinds = (
      await services.database.db.select().from(schema.eventLog).where(eq(schema.eventLog.workItemId, a))
    ).map((e) => e.kind);
    expect(kinds).toEqual(expect.arrayContaining(["dependencyAdded", "dependencyRemoved"]));
  });
});

describe("custom relations between work items", () => {
  const spaceId = randomUUID();
  let admin: { cookie: string; userId: string };
  let member: { cookie: string; userId: string };
  const run = (name: string, args: unknown, userId = admin.userId) => services.zero.run(name, args, userId);
  const needType = `${spaceId}/need`;
  const skuType = `${spaceId}/sku`;
  const [need, skuA, skuB, otherNeed] = [randomUUID(), randomUUID(), randomUUID(), randomUUID()];
  const linksOf = (fromId: string) =>
    services.database.db.select().from(schema.relation).where(eq(schema.relation.fromId, fromId));

  beforeAll(async () => {
    admin = await signUp(`rel-admin-${spaceId}@example.com`);
    member = await signUp(`rel-member-${spaceId}@example.com`);
    await run("space.create", { id: spaceId, name: "关联" });
    await services.database.db.insert(schema.spaceMember).values({ spaceId, userId: member.userId });
    for (const [typeId, key, name] of [
      [needType, "need", "需求"],
      [skuType, "sku", "SKU"],
    ] as const) {
      await run("workItemType.create", { id: typeId, spaceId, key, name });
      await run("flowTemplate.create", { id: `${typeId}/default`, typeId, key: "default", name: "默认" });
      await run("flowTemplate.saveDraft", {
        templateId: `${typeId}/default`,
        definition: {
          key,
          version: 0,
          nodes: [
            { key: "start", name: "开始", completion: "auto", ownerRoles: [] },
            { key: "do", name: "处理", completion: "singleConfirm", ownerRoles: [] },
          ],
          edges: [{ from: "start", to: "do" }],
        },
      });
      await run("flowTemplate.publish", { versionId: `${typeId}/default/v1` });
    }
    for (const [id, typeId, name] of [
      [need, needType, "新需求"],
      [otherNeed, needType, "另一个需求"],
      [skuA, skuType, "SKU-A"],
      [skuB, skuType, "SKU-B"],
    ] as const)
      await run("workItem.create", { id, typeId, name, fields: {}, roles: {} });
  });

  it("only lets space admins define relations, between types of the same space", async () => {
    await expect(
      run(
        "relationDef.create",
        { id: randomUUID(), fromTypeId: needType, toTypeId: skuType, name: "关联 SKU", cardinality: "many" },
        member.userId,
      ),
    ).rejects.toThrow("空间管理员");
    await run("relationDef.create", {
      id: `${needType}/rel/skus`,
      fromTypeId: needType,
      toTypeId: skuType,
      name: "关联 SKU",
      cardinality: "many",
    });
    await run("relationDef.create", {
      id: `${needType}/rel/main`,
      fromTypeId: needType,
      toTypeId: skuType,
      name: "主 SKU",
      cardinality: "one",
    });
    await expect(
      run("relationDef.create", {
        id: randomUUID(),
        fromTypeId: needType,
        toTypeId: skuType,
        name: "关联 SKU",
        cardinality: "many",
      }),
    ).rejects.toThrow("已经存在");
  });

  it("links items of the right types, once each, and replaces a single relation", async () => {
    const add = (relationDefId: string, toId: string, userId = member.userId) =>
      run("relation.add", { id: randomUUID(), relationDefId, fromId: need, toId }, userId);
    await add(`${needType}/rel/skus`, skuA);
    await add(`${needType}/rel/skus`, skuB);
    await expect(add(`${needType}/rel/skus`, skuA)).rejects.toThrow("已经关联过");
    await expect(add(`${needType}/rel/skus`, otherNeed)).rejects.toThrow("对应类型");
    const outsider = await signUp(`rel-outsider-${randomUUID()}@example.com`);
    await expect(add(`${needType}/rel/skus`, skuA, outsider.userId)).rejects.toThrow("没有权限");

    await add(`${needType}/rel/main`, skuA);
    await add(`${needType}/rel/main`, skuB);
    const links = await linksOf(need);
    expect(links.map((r) => [r.relationDefId, r.toId]).sort()).toEqual(
      [
        [`${needType}/rel/skus`, skuA],
        [`${needType}/rel/skus`, skuB],
        [`${needType}/rel/main`, skuB],
      ].sort(),
    );
    const events = await services.database.db
      .select()
      .from(schema.eventLog)
      .where(and(eq(schema.eventLog.workItemId, need), eq(schema.eventLog.kind, "relationAdded")));
    expect(events.at(-1)?.payload).toEqual({ relationDefId: `${needType}/rel/main`, toId: skuB, replaced: [skuA] });
  });

  it("removes one relation, and deleting a definition removes its relations", async () => {
    const main = (await linksOf(need)).find((r) => r.relationDefId === `${needType}/rel/main`);
    await run("relation.remove", { id: main?.id }, member.userId);
    expect((await linksOf(need)).filter((r) => r.relationDefId === `${needType}/rel/main`)).toEqual([]);

    await expect(run("relationDef.delete", { id: `${needType}/rel/skus` }, member.userId)).rejects.toThrow(
      "空间管理员",
    );
    await run("relationDef.delete", { id: `${needType}/rel/skus` });
    expect(await linksOf(need)).toEqual([]);
  });
});

describe("node tasks and completion forms", () => {
  const spaceId = randomUUID();
  const typeId = `${spaceId}/req`;
  let admin: { cookie: string; userId: string };
  let member: { cookie: string; userId: string };
  let itemId: string;
  const run = (name: string, args: unknown, userId = member.userId) => services.zero.run(name, args, userId);
  const db = () => services.database.db;
  const tasksOf = () =>
    db().select().from(schema.nodeTask).where(eq(schema.nodeTask.workItemId, itemId)).orderBy(schema.nodeTask.id);
  const nodeState = async (nodeKey: string) =>
    (
      await db()
        .select()
        .from(schema.nodeInstance)
        .where(eq(schema.nodeInstance.id, `${itemId}/${nodeKey}`))
    )[0]?.state;

  beforeAll(async () => {
    admin = await signUp(`task-admin-${spaceId}@example.com`);
    member = await signUp(`task-member-${spaceId}@example.com`);
    await run("space.create", { id: spaceId, name: "子任务" }, admin.userId);
    await db().insert(schema.spaceMember).values({ spaceId, userId: member.userId });
    await run("workItemType.create", { id: typeId, spaceId, key: "req", name: "需求" }, admin.userId);
    await run("roleDef.create", { id: `${typeId}/role/dev`, typeId, key: "dev", name: "开发" }, admin.userId);
    for (const key of ["版本号", "备注"])
      await run(
        "fieldDef.create",
        { id: `${typeId}/field/${key}`, typeId, key, name: key, dataType: "text" },
        admin.userId,
      );
    await run("flowTemplate.create", { id: `${typeId}/default`, typeId, key: "default", name: "默认" }, admin.userId);
    await run(
      "flowTemplate.saveDraft",
      {
        templateId: `${typeId}/default`,
        definition: {
          key: "default",
          version: 0,
          nodes: [
            { key: "start", name: "开始", completion: "auto", ownerRoles: [] },
            {
              key: "dev",
              name: "开发",
              completion: "singleConfirm",
              ownerRoles: ["dev"],
              tasks: ["写代码", "自测"],
              form: [{ field: "版本号", required: true }, { field: "备注" }],
            },
            { key: "done", name: "上线", completion: "singleConfirm", ownerRoles: ["dev"] },
          ],
          edges: [
            { from: "start", to: "dev" },
            { from: "dev", to: "done" },
          ],
        },
      },
      admin.userId,
    );
    await run("flowTemplate.publish", { versionId: `${typeId}/default/v1` }, admin.userId);
    itemId = randomUUID();
    await run("workItem.create", { id: itemId, typeId, name: "导出报表", fields: {}, roles: { dev: [member.userId] } });
  });

  it("refuses to publish a form that uses a missing field", async () => {
    const templateId = `${typeId}/broken`;
    await run("flowTemplate.create", { id: templateId, typeId, key: "broken", name: "坏的" }, admin.userId);
    await run(
      "flowTemplate.saveDraft",
      {
        templateId,
        definition: {
          key: "broken",
          version: 0,
          nodes: [{ key: "a", name: "A", completion: "singleConfirm", ownerRoles: [], form: [{ field: "不存在" }] }],
          edges: [],
        },
      },
      admin.userId,
    );
    await expect(run("flowTemplate.publish", { versionId: `${templateId}/v1` }, admin.userId)).rejects.toThrow(
      "完成表单用到的字段「不存在」不存在",
    );
  });

  it("creates the template's preset tasks with the work item", async () => {
    expect((await tasksOf()).map((t) => [t.nodeKey, t.name, t.done])).toEqual([
      ["dev", "写代码", false],
      ["dev", "自测", false],
    ]);
  });

  it("adds, assigns and ticks tasks, and tells the assignee", async () => {
    const outsider = await signUp(`task-outsider-${randomUUID()}@example.com`);
    const id = randomUUID();
    await expect(
      run("task.create", { id, workItemId: itemId, nodeKey: "dev", name: "x", assigneeId: outsider.userId }),
    ).rejects.toThrow("空间成员");
    await expect(
      run("task.create", { id, workItemId: itemId, nodeKey: "dev", name: "x" }, outsider.userId),
    ).rejects.toThrow("没有权限");

    await run(
      "task.create",
      { id, workItemId: itemId, nodeKey: "dev", name: "写文档", assigneeId: member.userId, due: "2026-11-02" },
      admin.userId,
    );
    const created = (await tasksOf()).find((t) => t.id === id);
    expect(created).toMatchObject({ assigneeId: member.userId, createdBy: admin.userId });
    expect(created?.dueDate?.toISOString()).toBe("2026-11-02T00:00:00.000Z");

    const [event] = await db()
      .select()
      .from(schema.eventLog)
      .where(and(eq(schema.eventLog.workItemId, itemId), eq(schema.eventLog.kind, "taskCreated")));
    await notify(services.database, event?.id as number);
    const inbox = await db().select().from(schema.notification).where(eq(schema.notification.userId, member.userId));
    expect(inbox.map((n) => [n.kind, n.text])).toContainEqual([
      "taskAssigned",
      "task-admin-" + spaceId + " 在「导出报表」给你分配了子任务「写文档」",
    ]);

    await run("task.update", { id, name: "写使用文档", due: null });
    expect((await tasksOf()).find((t) => t.id === id)).toMatchObject({ name: "写使用文档", dueDate: null });
  });

  it("blocks the confirm until every task is done and the form's required fields are filled", async () => {
    await expect(run("node.confirm", { workItemId: itemId, nodeKey: "dev" })).rejects.toThrow("3 个子任务没完成");
    for (const t of await tasksOf()) await run("task.setDone", { id: t.id, done: true });
    expect((await tasksOf()).every((t) => t.done && t.doneBy === member.userId)).toBe(true);

    await expect(run("node.confirm", { workItemId: itemId, nodeKey: "dev" })).rejects.toThrow("必填项");
    await expect(
      run("node.confirm", { workItemId: itemId, nodeKey: "dev", values: { 版本号: "1.0", 其它: "x" } }),
    ).rejects.toThrow("不在节点「开发」的完成表单里");
    // 被拒绝的确认什么也没写
    expect(await db().select().from(schema.fieldValue).where(eq(schema.fieldValue.workItemId, itemId))).toEqual([]);

    await run("node.confirm", { workItemId: itemId, nodeKey: "dev", values: { 版本号: "1.0", 备注: "首版" } });
    expect(await nodeState("dev")).toBe("completed");
    expect(await nodeState("done")).toBe("inProgress");
    const values = await db().select().from(schema.fieldValue).where(eq(schema.fieldValue.workItemId, itemId));
    expect(Object.fromEntries(values.map((v) => [v.fieldKey, v.value]))).toEqual({ 版本号: "1.0", 备注: "首版" });
    const kinds = (
      await db()
        .select()
        .from(schema.eventLog)
        .where(eq(schema.eventLog.workItemId, itemId))
        .orderBy(schema.eventLog.id)
    ).map((e) => e.kind);
    expect(kinds.slice(-4)).toEqual(["fieldChanged", "fieldChanged", "nodeCompleted", "nodeStarted"]);
  });

  it("freezes a completed node's tasks until the node is rolled back", async () => {
    const [task] = await tasksOf();
    await expect(run("task.setDone", { id: task?.id, done: false })).rejects.toThrow("已完成");
    await run("node.rollback", { workItemId: itemId, nodeKey: "dev" });
    await run("task.setDone", { id: task?.id, done: false });
    await run("task.delete", { id: task?.id });
    expect((await tasksOf()).map((t) => t.id)).not.toContain(task?.id);
  });
});

describe("status-flow work items", () => {
  const spaceId = randomUUID();
  const typeId = `${spaceId}/bug`;
  const templateId = `${typeId}/default`;
  let admin: { cookie: string; userId: string };
  let dev: { cookie: string; userId: string };
  let qa: { cookie: string; userId: string };
  let itemId: string;
  const run = (name: string, args: unknown, userId = admin.userId) => services.zero.run(name, args, userId);
  const item = async () =>
    (await services.database.db.select().from(schema.workItem).where(eq(schema.workItem.id, itemId)))[0];

  beforeAll(async () => {
    admin = await signUp(`st-admin-${spaceId}@example.com`);
    dev = await signUp(`st-dev-${spaceId}@example.com`);
    qa = await signUp(`st-qa-${spaceId}@example.com`);
    await run("space.create", { id: spaceId, name: "缺陷" });
    await services.database.db.insert(schema.spaceMember).values([
      { spaceId, userId: dev.userId },
      { spaceId, userId: qa.userId },
    ]);
    await run("workItemType.create", { id: typeId, spaceId, key: "bug", name: "缺陷", flowMode: "state" });
    await run("roleDef.create", { id: `${typeId}/role/dev`, typeId, key: "dev", name: "开发" });
    await run("roleDef.create", { id: `${typeId}/role/qa`, typeId, key: "qa", name: "测试" });
    await run("fieldDef.create", {
      id: `${typeId}/field/v`,
      typeId,
      key: "修复版本",
      name: "修复版本",
      dataType: "text",
    });
    await run("flowTemplate.create", { id: templateId, typeId, key: "default", name: "缺陷流程" });
  });

  it("starts a status-flow template with a usable default draft and refuses node-flow drafts", async () => {
    const [v1] = await services.database.db
      .select()
      .from(schema.flowVersion)
      .where(eq(schema.flowVersion.templateId, templateId));
    expect(v1?.definition).toMatchObject({
      mode: "state",
      statuses: [{ name: "待处理" }, { name: "处理中" }, { name: "已完成" }],
    });
    await expect(
      run("flowTemplate.saveDraft", { templateId, definition: { key: "x", version: 0, nodes: [], edges: [] } }),
    ).rejects.toThrow("这个类型用状态流");
  });

  it("refuses to publish a transition that names a missing role", async () => {
    await run("flowTemplate.saveDraft", {
      templateId,
      definition: {
        key: "x",
        version: 0,
        mode: "state",
        statuses: [
          { key: "open", name: "待处理", category: "todo" },
          { key: "closed", name: "已关闭", category: "closed" },
        ],
        transitions: [{ from: "open", to: "closed", roles: ["pm"] }],
      },
    });
    await expect(run("flowTemplate.publish", { versionId: `${templateId}/v1` })).rejects.toThrow(
      "流转「待处理 → 已关闭」的角色「pm」不存在",
    );
  });

  it("publishes a bug flow and starts new bugs in its first status", async () => {
    await run("flowTemplate.saveDraft", {
      templateId,
      definition: {
        key: "x",
        version: 0,
        mode: "state",
        statuses: [
          { key: "open", name: "待处理", category: "todo" },
          { key: "fixing", name: "处理中", category: "doing" },
          { key: "resolved", name: "已解决", category: "done" },
        ],
        transitions: [
          { from: "open", to: "fixing", roles: ["dev"] },
          { from: "fixing", to: "resolved", gate: { kind: "notEmpty", field: "修复版本" } },
          { from: "resolved", to: "fixing", roles: ["qa"] },
        ],
      },
    });
    await run("flowTemplate.publish", { versionId: `${templateId}/v1` });
    itemId = randomUUID();
    await run(
      "workItem.create",
      { id: itemId, typeId, name: "登录页白屏", fields: {}, roles: { dev: [dev.userId], qa: [qa.userId] } },
      dev.userId,
    );
    expect(await item()).toMatchObject({ flowStatus: "open", stage: "待处理", status: "inProgress" });
    const nodes = await services.database.db
      .select()
      .from(schema.nodeInstance)
      .where(eq(schema.nodeInstance.workItemId, itemId));
    expect(nodes).toEqual([]);
    await expect(run("node.confirm", { workItemId: itemId, nodeKey: "open" }, dev.userId)).rejects.toThrow(
      "没有节点流程",
    );
  });

  it("moves through the flow by role and gate, completing and reopening the bug", async () => {
    await expect(run("workItem.transition", { workItemId: itemId, to: "fixing" }, qa.userId)).rejects.toThrow(
      "没有权限",
    );
    await expect(run("workItem.transition", { workItemId: itemId, to: "resolved" }, dev.userId)).rejects.toThrow(
      "不能从「待处理」流转到「已解决」",
    );
    await run("workItem.transition", { workItemId: itemId, to: "fixing" }, dev.userId);
    expect(await item()).toMatchObject({ flowStatus: "fixing", stage: "处理中" });

    await expect(run("workItem.transition", { workItemId: itemId, to: "resolved" }, dev.userId)).rejects.toThrow(
      "条件还没满足",
    );
    await run("fieldValue.set", { workItemId: itemId, fieldKey: "修复版本", value: "1.2.0" }, dev.userId);
    await run("workItem.transition", { workItemId: itemId, to: "resolved" }, dev.userId);
    expect(await item()).toMatchObject({ flowStatus: "resolved", stage: "已解决", status: "completed" });

    // 管理员不担任角色也能流转
    await run("workItem.transition", { workItemId: itemId, to: "fixing" });
    expect(await item()).toMatchObject({ flowStatus: "fixing", status: "inProgress" });

    const events = await services.database.db
      .select()
      .from(schema.eventLog)
      .where(eq(schema.eventLog.workItemId, itemId))
      .orderBy(schema.eventLog.id);
    expect(events.filter((e) => e.kind !== "fieldChanged").map((e) => [e.kind, e.payload])).toEqual([
      ["workItemCreated", expect.anything()],
      ["statusChanged", { from: "open", to: "fixing", by: dev.userId }],
      ["statusChanged", { from: "fixing", to: "resolved", by: dev.userId }],
      ["workItemCompleted", {}],
      ["statusChanged", { from: "resolved", to: "fixing", by: admin.userId }],
      ["workItemReopened", {}],
    ]);
  });
});

describe("permissions", () => {
  const spaceId = randomUUID();
  const typeId = `${spaceId}/req`;
  const templateId = `${typeId}/default`;
  let admin: { cookie: string; userId: string };
  let dev: { cookie: string; userId: string };
  let other: { cookie: string; userId: string };
  let guest: { cookie: string; userId: string };
  let itemId: string;
  const run = (name: string, args: unknown, userId = admin.userId) => services.zero.run(name, args, userId);
  const viewers = async () =>
    (await services.database.db.select().from(schema.fieldViewer).where(eq(schema.fieldViewer.workItemId, itemId)))
      .map((v) => `${v.fieldKey}:${v.userId}`)
      .sort();
  const value = async (fieldKey: string) =>
    (
      await services.database.db
        .select()
        .from(schema.fieldValue)
        .where(and(eq(schema.fieldValue.workItemId, itemId), eq(schema.fieldValue.fieldKey, fieldKey)))
    )[0];

  beforeAll(async () => {
    admin = await signUp(`pm-admin-${spaceId}@example.com`);
    dev = await signUp(`pm-dev-${spaceId}@example.com`);
    other = await signUp(`pm-other-${spaceId}@example.com`);
    guest = await signUp(`pm-guest-${spaceId}@example.com`);
    await run("space.create", { id: spaceId, name: "权限" });
    await services.database.db.insert(schema.spaceMember).values([
      { spaceId, userId: dev.userId },
      { spaceId, userId: other.userId },
      { spaceId, userId: guest.userId, role: "guest" },
    ]);
    await run("workItemType.create", { id: typeId, spaceId, key: "req", name: "需求" });
    await run("roleDef.create", { id: `${typeId}/role/dev`, typeId, key: "dev", name: "开发" });
    await run("roleDef.create", { id: `${typeId}/role/qa`, typeId, key: "qa", name: "测试" });
    for (const key of ["报价", "备注"])
      await run("fieldDef.create", { id: `${typeId}/field/${key}`, typeId, key, name: key, dataType: "text" });
    await run("flowTemplate.create", { id: templateId, typeId, key: "default", name: "流程" });
    await run("flowTemplate.saveDraft", {
      templateId,
      definition: {
        key: "default",
        version: 0,
        nodes: [
          { key: "start", name: "开始", completion: "auto", ownerRoles: [] },
          { key: "dev", name: "开发", completion: "singleConfirm", ownerRoles: ["dev"], operatorRoles: ["qa"] },
        ],
        edges: [{ from: "start", to: "dev" }],
      },
    });
    await run("flowTemplate.publish", { versionId: `${templateId}/v1` });
    itemId = randomUUID();
    await run("workItem.create", { id: itemId, typeId, name: "导出", roles: { dev: [dev.userId], qa: [] } });
  });

  it("only admins change member roles, and the last admin stays", async () => {
    await expect(
      run("space.setMemberRole", { spaceId, userId: other.userId, role: "admin" }, dev.userId),
    ).rejects.toThrow("只有空间管理员可以修改成员角色");
    await expect(run("space.setMemberRole", { spaceId, userId: admin.userId, role: "member" })).rejects.toThrow(
      "至少要有一个管理员",
    );
    await expect(run("space.removeMember", { spaceId, userId: admin.userId })).rejects.toThrow("至少要有一个管理员");
  });

  it("guests can read and comment but not change work items", async () => {
    await expect(
      run("fieldValue.set", { workItemId: itemId, fieldKey: "备注", value: "x" }, guest.userId),
    ).rejects.toThrow("访客只能查看和评论");
    await expect(run("workItem.create", { id: randomUUID(), typeId, name: "访客建的" }, guest.userId)).rejects.toThrow(
      "访客只能查看和评论",
    );
    await expect(run("node.confirm", { workItemId: itemId, nodeKey: "dev" }, guest.userId)).rejects.toThrow(
      "访客只能查看和评论",
    );
    await expect(run("role.set", { workItemId: itemId, roleKey: "qa", userIds: [guest.userId] })).rejects.toThrow(
      "访客不能担任角色",
    );
    await run("comment.create", { id: randomUUID(), workItemId: itemId, body: "看过了", mentions: [] }, guest.userId);
  });

  it("restricts editing a field to its edit roles", async () => {
    await run("fieldDef.setAccess", { id: `${typeId}/field/备注`, viewRoles: [], editRoles: ["dev"] });
    await expect(
      run("fieldValue.set", { workItemId: itemId, fieldKey: "备注", value: "y" }, other.userId),
    ).rejects.toThrow("你没有权限修改「备注」");
    await run("fieldValue.set", { workItemId: itemId, fieldKey: "备注", value: "y" }, dev.userId);
    await run("fieldValue.set", { workItemId: itemId, fieldKey: "备注", value: "z" }, admin.userId);
    expect((await value("备注"))?.restricted).toBe(false);
  });

  it("keeps restricted field values' viewer list in step with roles and field access", async () => {
    await run("fieldValue.set", { workItemId: itemId, fieldKey: "报价", value: "100" });
    expect((await value("报价"))?.restricted).toBe(false);

    await run("fieldDef.setAccess", { id: `${typeId}/field/报价`, viewRoles: ["qa"], editRoles: ["dev"] });
    expect((await value("报价"))?.restricted).toBe(true);
    expect(await viewers()).toEqual([`报价:${dev.userId}`]);

    await run("role.set", { workItemId: itemId, roleKey: "qa", userIds: [other.userId] });
    expect(await viewers()).toEqual([`报价:${dev.userId}`, `报价:${other.userId}`].sort());

    await run("fieldDef.setAccess", { id: `${typeId}/field/报价`, viewRoles: [], editRoles: [] });
    expect((await value("报价"))?.restricted).toBe(false);
    expect(await viewers()).toEqual([]);
  });

  it("filters restricted values in the synced query", async () => {
    const body = JSON.stringify(["transform", [{ id: "q1", name: "workItems.byId", args: [{ id: itemId }] }]]);
    const res = await app.request("/api/zero/query?schema=zero_0&appID=zero", {
      method: "POST",
      body,
      headers: { cookie: dev.cookie },
    });
    const ast = JSON.stringify(((await res.json()) as { queries: { ast: unknown }[] }).queries[0]?.ast);
    expect(ast).toContain("restricted");
    expect(ast).toContain("field_viewer");
  });

  it("records the changed field on events and filters restricted changes out of the activity query", async () => {
    const changes = await services.database.db
      .select({ fieldKey: schema.eventLog.fieldKey, payload: schema.eventLog.payload })
      .from(schema.eventLog)
      .where(and(eq(schema.eventLog.workItemId, itemId), eq(schema.eventLog.kind, "fieldChanged")));
    expect(changes.length).toBeGreaterThan(0);
    for (const c of changes) expect(c.fieldKey).toBe(c.payload.fieldKey);

    const body = JSON.stringify([
      "transform",
      [{ id: "q1", name: "workItems.activity", args: [{ workItemId: itemId, limit: 50 }] }],
    ]);
    const res = await app.request("/api/zero/query?schema=zero_0&appID=zero", {
      method: "POST",
      body,
      headers: { cookie: dev.cookie },
    });
    const ast = JSON.stringify(((await res.json()) as { queries: { ast: unknown }[] }).queries[0]?.ast);
    expect(ast).toContain("event_log");
    expect(ast).toContain("field_viewer");
  });

  it("lets operator roles roll back and re-plan a node, not just its owners", async () => {
    // other 现在是“测试”，节点“开发”的可操作角色
    await run(
      "node.setPlan",
      { workItemId: itemId, nodeKey: "dev", start: "2026-11-02", end: "2026-11-03" },
      other.userId,
    );
    await run("role.set", { workItemId: itemId, roleKey: "qa", userIds: [] });
    await expect(run("node.setPlan", { workItemId: itemId, nodeKey: "dev" }, other.userId)).rejects.toThrow(
      "只有节点负责人、可操作角色或空间管理员可以调整排期",
    );
  });
});

describe("typed field values", () => {
  const spaceId = randomUUID();
  const typeId = `${spaceId}/task`;
  const templateId = `${typeId}/default`;
  let admin: { cookie: string; userId: string };
  let stranger: { cookie: string; userId: string };
  let itemId: string;
  const run = (name: string, args: unknown, userId = admin.userId) => services.zero.run(name, args, userId);
  const set = (fieldKey: string, value: unknown) => run("fieldValue.set", { workItemId: itemId, fieldKey, value });
  const row = async (fieldKey: string) =>
    (
      await services.database.db
        .select()
        .from(schema.fieldValue)
        .where(and(eq(schema.fieldValue.workItemId, itemId), eq(schema.fieldValue.fieldKey, fieldKey)))
    )[0];
  const items = async (fieldKey: string) =>
    (
      await services.database.db
        .select()
        .from(schema.fieldValueItem)
        .where(and(eq(schema.fieldValueItem.workItemId, itemId), eq(schema.fieldValueItem.fieldKey, fieldKey)))
    )
      .map((r) => r.item)
      .sort();

  beforeAll(async () => {
    admin = await signUp(`ft-admin-${spaceId}@example.com`);
    stranger = await signUp(`ft-stranger-${spaceId}@example.com`);
    await run("space.create", { id: spaceId, name: "字段类型" });
    await run("workItemType.create", { id: typeId, spaceId, key: "task", name: "任务", flowMode: "state" });
    const field = (key: string, dataType: string, options?: string[]) =>
      run("fieldDef.create", {
        id: `${typeId}/field/${key}`,
        typeId,
        key,
        name: key,
        dataType,
        ...(options && { options: options.map((o) => ({ value: o, label: o })) }),
      });
    await field("工时", "number");
    await field("截止", "date");
    await field("标签", "multiSelect", ["前端", "后端", "测试"]);
    await field("协作人", "user");
    await field("文档", "link");
    await run("flowTemplate.create", { id: templateId, typeId, key: "default", name: "流程" });
    await run("flowTemplate.publish", { versionId: `${templateId}/v1` });
    itemId = randomUUID();
    await run("workItem.create", {
      id: itemId,
      typeId,
      name: "接口联调",
      fields: { 工时: "8", 标签: ["后端", "前端"] },
    });
  });

  it("normalizes values on create and keeps the filter index", async () => {
    expect(await row("工时")).toMatchObject({ value: 8, num: 8 });
    expect((await row("标签"))?.value).toEqual(["前端", "后端"]);
    expect(await items("标签")).toEqual(["前端", "后端"].sort());
  });

  it("validates each type and updates the index on change", async () => {
    await expect(set("工时", "很多")).rejects.toThrow("「工时」要填数字");
    await expect(set("截止", "2026-13-01")).rejects.toThrow("要填日期");
    await expect(set("标签", ["运维"])).rejects.toThrow("没有选项「运维」");
    await expect(set("文档", "docs")).rejects.toThrow("http");
    await expect(set("协作人", [stranger.userId])).rejects.toThrow("「协作人」只能选空间成员");
    await expect(set("不存在", "x")).rejects.toThrow("字段「不存在」不存在");

    await set("截止", "2026-11-02");
    expect(await row("截止")).toMatchObject({ value: "2026-11-02", str: "2026-11-02" });
    expect((await row("截止"))?.num).toBe(Date.parse("2026-11-02T00:00:00Z") / 86_400_000);
    await set("标签", ["测试"]);
    expect(await items("标签")).toEqual(["测试"]);
    await set("协作人", [admin.userId]);
    expect(await items("协作人")).toEqual([admin.userId]);
    await set("标签", null);
    expect(await items("标签")).toEqual([]);

    const [event] = await services.database.db
      .select()
      .from(schema.eventLog)
      .where(and(eq(schema.eventLog.workItemId, itemId), eq(schema.eventLog.kind, "fieldChanged")))
      .orderBy(desc(schema.eventLog.id))
      .limit(1);
    expect(event?.payload).toEqual({ fieldKey: "标签", from: ["测试"], to: null });
  });

  it("puts field filters into the synced list query", async () => {
    const filter = {
      fields: [
        { field: "标签", op: "in", values: ["后端"] },
        { field: "工时", op: "range", min: 4 },
        { field: "截止", op: "range", max: "2026-12-31" },
        { field: "文档", op: "contains", text: "wiki" },
      ],
    };
    const body = JSON.stringify(["transform", [{ id: "q1", name: "workItems.bySpace", args: [{ spaceId, filter }] }]]);
    const res = await app.request("/api/zero/query?schema=zero_0&appID=zero", {
      method: "POST",
      body,
      headers: { cookie: admin.cookie },
    });
    const ast = JSON.stringify(((await res.json()) as { queries: { ast: unknown }[] }).queries[0]?.ast);
    for (const part of ["field_value_item", "后端", '"num"', "ILIKE", "%wiki%"]) expect(ast).toContain(part);
  });
});

describe("formula fields", () => {
  const spaceId = randomUUID();
  const projectType = `${spaceId}/project`;
  const taskType = `${spaceId}/task`;
  const parentId = randomUUID();
  let admin: { cookie: string; userId: string };
  const run = (name: string, args: unknown, userId = admin.userId) => services.zero.run(name, args, userId);
  const field = (typeId: string, key: string, dataType: string, formula?: string) =>
    run("fieldDef.create", { id: `${typeId}/field/${key}`, typeId, key, name: key, dataType, formula });
  const value = async (workItemId: string, fieldKey: string) =>
    (
      await services.database.db
        .select()
        .from(schema.fieldValue)
        .where(and(eq(schema.fieldValue.workItemId, workItemId), eq(schema.fieldValue.fieldKey, fieldKey)))
    )[0];

  beforeAll(async () => {
    admin = await signUp(`formula-${spaceId}@example.com`);
    await run("space.create", { id: spaceId, name: "公式" });
    for (const [typeId, key, name, nodes, edges] of [
      [
        projectType,
        "project",
        "项目",
        [
          { key: "start", name: "开始", completion: "auto", ownerRoles: [] },
          { key: "build", name: "开发", completion: "subItemDriven", ownerRoles: ["owner"] },
        ],
        [{ from: "start", to: "build" }],
      ],
      [
        taskType,
        "task",
        "任务",
        [
          { key: "start", name: "开始", completion: "auto", ownerRoles: [] },
          { key: "work", name: "处理", completion: "singleConfirm", ownerRoles: ["owner"] },
        ],
        [{ from: "start", to: "work" }],
      ],
    ] as const) {
      await run("workItemType.create", { id: typeId, spaceId, key, name });
      await run("roleDef.create", { id: `${typeId}/role/owner`, typeId, key: "owner", name: "负责人" });
      await run("flowTemplate.create", { id: `${typeId}/default`, typeId, key: "default", name: "默认流程" });
      await run("flowTemplate.saveDraft", {
        templateId: `${typeId}/default`,
        definition: { key, version: 0, nodes, edges },
      });
      await run("flowTemplate.publish", { versionId: `${typeId}/default/v1` });
    }
    await field(taskType, "工时", "number");
    await field(taskType, "单价", "number");
  });

  it("checks formulas when they are defined", async () => {
    await expect(field(taskType, "坏", "formula", "{不存在} + 1")).rejects.toThrow("公式有误：字段「不存在」不存在");
    await expect(field(taskType, "坏", "formula", "SUM(")).rejects.toThrow("公式有误");
    await expect(field(taskType, "坏", "formula", "")).rejects.toThrow("要填公式");
  });

  it("computes formulas on the server, in dependency order, and keeps them in step with their inputs", async () => {
    const id = randomUUID();
    await run("workItem.create", { id, typeId: taskType, name: "联调", fields: { 工时: 8 }, roles: {} });
    await field(taskType, "总价", "formula", "{工时} * {单价}");
    await field(taskType, "含税", "formula", "ROUND({总价} * 1.1, 2)");
    // 已有的工作项在定义公式时就算好了
    expect(await value(id, "总价")).toMatchObject({ value: 0, num: 0 });

    await run("fieldValue.set", { workItemId: id, fieldKey: "单价", value: 12.5 });
    expect(await value(id, "总价")).toMatchObject({ value: 100, num: 100 });
    expect((await value(id, "含税"))?.value).toBe(110);
    expect((await value(id, "含税"))?.computedAt).not.toBeNull();

    // 公式字段不能手动改；改公式后重算，循环引用会被拒绝
    await expect(run("fieldValue.set", { workItemId: id, fieldKey: "总价", value: 1 })).rejects.toThrow("不能手动修改");
    await run("fieldDef.setFormula", { id: `${taskType}/field/总价`, formula: "{工时} * {单价} * 2" });
    expect((await value(id, "总价"))?.value).toBe(200);
    expect((await value(id, "含税"))?.value).toBe(220);
    await expect(run("fieldDef.setFormula", { id: `${taskType}/field/总价`, formula: "{含税} + 1" })).rejects.toThrow(
      "循环引用",
    );
    const [def] = await services.database.db
      .select()
      .from(schema.fieldDef)
      .where(eq(schema.fieldDef.id, `${taskType}/field/总价`));
    expect(def?.formula).toBe("{工时} * {单价} * 2");
  });

  it("rolls up sub-items into the parent", async () => {
    await field(projectType, "总工时", "formula", "SUBITEMS_SUM({工时})");
    await field(projectType, "进度", "formula", "SUBITEMS_DONE() / SUBITEMS_COUNT()");
    await run("workItem.create", {
      id: parentId,
      typeId: projectType,
      name: "官网改版",
      fields: {},
      roles: { owner: [admin.userId] },
    });
    expect(await value(parentId, "总工时")).toMatchObject({ value: 0 });
    expect(await value(parentId, "进度")).toBeUndefined();

    const [a, b] = [randomUUID(), randomUUID()];
    await run("workItem.createSubItem", { id: a, parentId, nodeKey: "build", typeId: taskType, name: "首页" });
    await run("workItem.createSubItem", { id: b, parentId, nodeKey: "build", typeId: taskType, name: "详情页" });
    expect((await value(parentId, "进度"))?.value).toBe(0);
    await run("fieldValue.set", { workItemId: a, fieldKey: "工时", value: 3 });
    await run("fieldValue.set", { workItemId: b, fieldKey: "工时", value: 5 });
    expect((await value(parentId, "总工时"))?.value).toBe(8);

    await run("node.confirm", { workItemId: a, nodeKey: "work" });
    expect((await value(parentId, "进度"))?.value).toBe(0.5);
  });
});

describe("attachments", () => {
  const spaceId = randomUUID();
  const typeId = `${spaceId}/task`;
  const itemId = randomUUID();
  let admin: { cookie: string; userId: string };
  let member: { cookie: string; userId: string };
  let other: { cookie: string; userId: string };
  let guest: { cookie: string; userId: string };
  let outsider: { cookie: string; userId: string };
  const run = (name: string, args: unknown, userId = admin.userId) => services.zero.run(name, args, userId);
  const upload = (who: { cookie: string }, name: string, content: string, type = "text/plain") => {
    const body = new FormData();
    body.append("file", new File([content], name, { type }));
    return app.request(`/api/work-items/${itemId}/attachments`, {
      method: "POST",
      body,
      headers: { cookie: who.cookie },
    });
  };
  const events = async (kind: string) =>
    services.database.db
      .select()
      .from(schema.eventLog)
      .where(and(eq(schema.eventLog.workItemId, itemId), eq(schema.eventLog.kind, kind)));

  beforeAll(async () => {
    const user = (who: string) => signUp(`att-${who}-${spaceId}@example.com`);
    [admin, member, other, guest, outsider] = [
      await user("admin"),
      await user("member"),
      await user("other"),
      await user("guest"),
      await user("outsider"),
    ];
    await run("space.create", { id: spaceId, name: "附件" });
    await services.database.db.insert(schema.spaceMember).values([
      { spaceId, userId: member.userId },
      { spaceId, userId: other.userId },
      { spaceId, userId: guest.userId, role: "guest" },
    ]);
    await run("workItemType.create", { id: typeId, spaceId, key: "task", name: "任务", flowMode: "state" });
    await run("flowTemplate.create", { id: `${typeId}/default`, typeId, key: "default", name: "流程" });
    await run("flowTemplate.publish", { versionId: `${typeId}/default/v1` });
    await run("workItem.create", { id: itemId, typeId, name: "需求文档", fields: {} });
  });

  it("stores uploads, logs them, and serves them only to space members", async () => {
    const res = await upload(member, "需求 v1.txt", "第一版");
    expect(res.status).toBe(200);
    const { id } = (await res.json()) as { id: string };
    const [row] = await services.database.db.select().from(schema.attachment).where(eq(schema.attachment.id, id));
    expect(row).toMatchObject({
      workItemId: itemId,
      name: "需求 v1.txt",
      size: Buffer.byteLength("第一版"),
      uploadedBy: member.userId,
    });
    expect((await events("attachmentAdded")).map((e) => e.payload)).toEqual([
      { attachmentId: id, name: "需求 v1.txt" },
    ]);

    const download = await app.request(`/api/attachments/${id}`, { headers: { cookie: guest.cookie } });
    expect(download.status).toBe(200);
    expect(await download.text()).toBe("第一版");
    expect(download.headers.get("content-disposition")).toBe(
      `attachment; filename="__ v1.txt"; filename*=UTF-8''${encodeURIComponent("需求 v1.txt")}`,
    );
    expect(download.headers.get("content-type")).toBe("application/octet-stream");
    const inline = await app.request(`/api/attachments/${id}?inline`, { headers: { cookie: guest.cookie } });
    expect(inline.headers.get("content-type")).toBe("text/plain");
    expect(inline.headers.get("content-disposition")).toMatch(/^inline;/);

    expect((await app.request(`/api/attachments/${id}`, { headers: { cookie: outsider.cookie } })).status).toBe(404);
    expect((await app.request(`/api/attachments/${id}`)).status).toBe(401);
  });

  it("lets only writers upload, and only the uploader or an admin delete", async () => {
    expect((await upload(guest, "a.txt", "x")).status).toBe(403);
    expect((await upload(outsider, "a.txt", "x")).status).toBe(404);
    // SVG 可能带脚本，不内联
    const svg = (await (await upload(member, "图.svg", "<svg/>", "image/svg+xml")).json()) as { id: string };
    const res = await app.request(`/api/attachments/${svg.id}?inline`, { headers: { cookie: member.cookie } });
    expect(res.headers.get("content-type")).toBe("application/octet-stream");

    const remove = (who: { cookie: string }) =>
      app.request(`/api/attachments/${svg.id}`, { method: "DELETE", headers: { cookie: who.cookie } });
    expect((await remove(other)).status).toBe(403);
    expect((await remove(guest)).status).toBe(403);
    expect((await remove(member)).status).toBe(200);
    expect((await app.request(`/api/attachments/${svg.id}`, { headers: { cookie: member.cookie } })).status).toBe(404);
    expect((await events("attachmentRemoved")).map((e) => e.payload)).toEqual([
      { attachmentId: svg.id, name: "图.svg" },
    ]);

    const mine = (await (await upload(other, "b.txt", "y")).json()) as { id: string };
    expect(
      (await app.request(`/api/attachments/${mine.id}`, { method: "DELETE", headers: { cookie: admin.cookie } }))
        .status,
    ).toBe(200);
  });
});

describe("global search", () => {
  it("only searches field values the user can see", async () => {
    const user = await signUp(`search-${randomUUID()}@example.com`);
    const body = JSON.stringify(["transform", [{ id: "q1", name: "search.workItems", args: [{ q: "100%_" }] }]]);
    const res = await app.request("/api/zero/query?schema=zero_0&appID=zero", {
      method: "POST",
      body,
      headers: { cookie: user.cookie },
    });
    const ast = JSON.stringify(((await res.json()) as { queries: { ast: unknown }[] }).queries[0]?.ast);
    expect(ast).toContain("field_viewer");
    expect(ast).toContain("ILIKE");
    // 通配符被转义，按字面匹配
    expect(ast).toContain(String.raw`%100\\%\\_%`);
  });
});

describe("detail layout", () => {
  const spaceId = randomUUID();
  const typeId = `${spaceId}/req`;
  let admin: { cookie: string; userId: string };
  let member: { cookie: string; userId: string };
  const run = (name: string, args: unknown, userId = admin.userId) => services.zero.run(name, args, userId);
  const stored = async () =>
    (await services.database.db.select().from(schema.workItemType).where(eq(schema.workItemType.id, typeId)))[0]
      ?.detailLayout;

  beforeAll(async () => {
    admin = await signUp(`layout-admin-${spaceId}@example.com`);
    member = await signUp(`layout-member-${spaceId}@example.com`);
    await run("space.create", { id: spaceId, name: "布局" });
    await services.database.db.insert(schema.spaceMember).values({ spaceId, userId: member.userId });
    await run("workItemType.create", { id: typeId, spaceId, key: "req", name: "需求" });
    for (const key of ["优先级", "报价", "备注"])
      await run("fieldDef.create", { id: `${typeId}/field/${key}`, typeId, key, name: key, dataType: "text" });
  });

  it("saves a checked layout, admins only", async () => {
    const layout = {
      groups: [
        { name: "基本信息", fields: ["优先级"] },
        { name: "财务", fields: ["报价"], collapsed: true },
      ],
      hidden: ["备注"],
    };
    await expect(run("workItemType.setLayout", { id: typeId, layout }, member.userId)).rejects.toThrow(
      "只有空间管理员",
    );
    await expect(
      run("workItemType.setLayout", { id: typeId, layout: { groups: [{ name: "x", fields: ["不存在"] }] } }),
    ).rejects.toThrow("字段「不存在」不存在");
    await expect(
      run("workItemType.setLayout", {
        id: typeId,
        layout: { groups: [{ name: "x", fields: ["报价"] }], hidden: ["报价"] },
      }),
    ).rejects.toThrow("不止一次");
    expect(await stored()).toBeNull();

    await run("workItemType.setLayout", { id: typeId, layout });
    expect(await stored()).toEqual(layout);
    await run("workItemType.setLayout", { id: typeId, layout: null });
    expect(await stored()).toBeNull();
  });
});

describe("open API", () => {
  const spaceId = randomUUID();
  const typeId = `${spaceId}/bug`;
  const templateId = `${typeId}/default`;
  let admin: { cookie: string; userId: string };
  let stranger: { cookie: string; userId: string };
  let token: string;
  const run = (name: string, args: unknown, userId = admin.userId) => services.zero.run(name, args, userId);
  const call = (path: string, init: { method?: string; body?: unknown; token?: string } = {}) =>
    app.request(`/open-api/v1${path}`, {
      method: init.method ?? "GET",
      headers: {
        authorization: `Bearer ${init.token ?? token}`,
        ...(init.body !== undefined && { "content-type": "application/json" }),
      },
      ...(init.body !== undefined && { body: JSON.stringify(init.body) }),
    });

  beforeAll(async () => {
    admin = await signUp(`open-admin-${spaceId}@example.com`);
    stranger = await signUp(`open-stranger-${spaceId}@example.com`);
    await run("space.create", { id: spaceId, name: "开放接口" });
    await run("workItemType.create", { id: typeId, spaceId, key: "bug", name: "缺陷", flowMode: "state" });
    await run("roleDef.create", { id: `${typeId}/role/dev`, typeId, key: "dev", name: "开发" });
    await run("fieldDef.create", {
      id: `${typeId}/field/sev`,
      typeId,
      key: "严重程度",
      name: "严重程度",
      dataType: "text",
    });
    await run("flowTemplate.create", { id: templateId, typeId, key: "default", name: "流程" });
    await run("flowTemplate.publish", { versionId: `${templateId}/v1` });
  });

  it("manages tokens with the session, and only shows the secret once", async () => {
    const created = await app.request("/api/tokens", {
      method: "POST",
      headers: { cookie: admin.cookie, "content-type": "application/json" },
      body: JSON.stringify({ name: "CI 集成" }),
    });
    expect(created.status).toBe(201);
    token = ((await created.json()) as { token: string }).token;
    expect(token).toMatch(/^fp_/);
    const listed = (await (await app.request("/api/tokens", { headers: { cookie: admin.cookie } })).json()) as {
      name: string;
      prefix: string;
    }[];
    expect(listed).toEqual([expect.objectContaining({ name: "CI 集成", prefix: token.slice(0, 10) })]);
    expect(JSON.stringify(listed)).not.toContain(token);
    // 令牌本身不能用来管理令牌
    expect((await app.request("/api/tokens", { headers: { authorization: `Bearer ${token}` } })).status).toBe(401);
  });

  it("rejects requests without a valid token", async () => {
    expect((await call("/spaces", { token: "fp_nope" })).status).toBe(401);
    expect((await app.request("/open-api/v1/spaces")).status).toBe(401);
  });

  it("reads spaces and creates, updates and moves work items as the token's user", async () => {
    const spaces = (await (await call("/spaces")).json()) as { id: string }[];
    expect(spaces.map((s) => s.id)).toContain(spaceId);
    const space = (await (await call(`/spaces/${spaceId}`)).json()) as {
      types: { id: string; fields: { key: string }[] }[];
    };
    expect(space.types[0]).toMatchObject({ id: typeId, fields: [{ key: "严重程度" }] });

    const res = await call("/work-items", {
      method: "POST",
      body: { typeId, name: "导出失败", fields: { 严重程度: "高" }, roles: { dev: [admin.userId] } },
    });
    expect(res.status).toBe(201);
    const item = (await res.json()) as { id: string; flowStatus: string; fields: Record<string, unknown> };
    expect(item).toMatchObject({ flowStatus: "todo", fields: { 严重程度: "高" } });

    const patched = (await (
      await call(`/work-items/${item.id}/fields`, { method: "PATCH", body: { fields: { 严重程度: "中" } } })
    ).json()) as { fields: Record<string, unknown> };
    expect(patched.fields.严重程度).toBe("中");

    const moved = (await (
      await call(`/work-items/${item.id}/transition`, { method: "POST", body: { to: "doing" } })
    ).json()) as { flowStatus: string; stage: string };
    expect(moved).toMatchObject({ flowStatus: "doing", stage: "处理中" });
    const bad = await call(`/work-items/${item.id}/transition`, { method: "POST", body: { to: "nowhere" } });
    expect(bad.status).toBe(400);
    expect(((await bad.json()) as { message: string }).message).toBeTruthy();

    expect((await call(`/work-items/${item.id}/comments`, { method: "POST", body: { body: "已定位" } })).status).toBe(
      201,
    );
    const events = await services.database.db
      .select()
      .from(schema.eventLog)
      .where(eq(schema.eventLog.workItemId, item.id));
    expect(events.map((e) => e.kind)).toEqual(
      expect.arrayContaining(["workItemCreated", "fieldChanged", "statusChanged", "commentAdded"]),
    );
  });

  it("pages through work items", async () => {
    for (const name of ["a", "b", "c"]) await call("/work-items", { method: "POST", body: { typeId, name } });
    const first = (await (
      await call(`/spaces/${spaceId}/work-items/query`, { method: "POST", body: { limit: 2 } })
    ).json()) as { items: { name: string }[]; nextCursor: string | null };
    expect(first.items.map((i) => i.name)).toEqual(["c", "b"]);
    const second = (await (
      await call(`/spaces/${spaceId}/work-items/query`, {
        method: "POST",
        body: { limit: 2, cursor: first.nextCursor },
      })
    ).json()) as { items: { name: string }[]; nextCursor: string | null };
    expect(second.items.map((i) => i.name)).toEqual(["a", "导出失败"]);
    expect(second.nextCursor).toBeNull();
  });

  it("keeps other users' spaces out of reach", async () => {
    const created = await app.request("/api/tokens", {
      method: "POST",
      headers: { cookie: stranger.cookie, "content-type": "application/json" },
      body: JSON.stringify({ name: "x" }),
    });
    const strangerToken = ((await created.json()) as { token: string }).token;
    expect((await call(`/spaces/${spaceId}`, { token: strangerToken })).status).toBe(404);
    const [item] = await services.database.db
      .select()
      .from(schema.workItem)
      .where(eq(schema.workItem.spaceId, spaceId));
    expect((await call(`/work-items/${item?.id}`, { token: strangerToken })).status).toBe(404);
    const create = await call("/work-items", { method: "POST", token: strangerToken, body: { typeId, name: "x" } });
    expect(create.status).toBe(400);
  });

  it("serves the OpenAPI description", async () => {
    const spec = (await (await app.request("/open-api/v1/spec.json")).json()) as { paths: Record<string, unknown> };
    expect(Object.keys(spec.paths)).toEqual(
      expect.arrayContaining(["/spaces", "/work-items", "/work-items/{id}", "/work-items/{id}/transition"]),
    );
  });
});

describe("webhook config", () => {
  const spaceId = randomUUID();
  let admin: { cookie: string; userId: string };
  let member: { cookie: string; userId: string };
  const run = (name: string, args: unknown, userId = admin.userId) => services.zero.run(name, args, userId);
  const secret = "x".repeat(40);

  beforeAll(async () => {
    admin = await signUp(`hook-admin-${spaceId}@example.com`);
    member = await signUp(`hook-member-${spaceId}@example.com`);
    await run("space.create", { id: spaceId, name: "Webhook" });
    await services.database.db.insert(schema.spaceMember).values({ spaceId, userId: member.userId });
  });

  it("lets admins create, change and delete webhooks with valid addresses", async () => {
    const id = randomUUID();
    const hook = { id, spaceId, name: "ERP", url: "https://erp.example.com/hook", secret };
    await expect(run("webhook.create", hook, member.userId)).rejects.toThrow("只有空间管理员");
    await expect(run("webhook.create", { ...hook, url: "ftp://erp.example.com" })).rejects.toThrow();
    await expect(run("webhook.create", { ...hook, url: "https://u:p@erp.example.com" })).rejects.toThrow();
    await expect(run("webhook.create", { ...hook, secret: "short" })).rejects.toThrow();
    await expect(run("webhook.create", { ...hook, events: ["nope"] })).rejects.toThrow();

    await run("webhook.create", { ...hook, events: ["statusChanged", "statusChanged"] });
    const stored = async () =>
      (await services.database.db.select().from(schema.webhook).where(eq(schema.webhook.id, id)))[0];
    expect(await stored()).toMatchObject({ events: ["statusChanged"], enabled: true, createdBy: admin.userId });
    await expect(run("webhook.update", { id, enabled: false }, member.userId)).rejects.toThrow("只有空间管理员");
    await run("webhook.update", { id, enabled: false, events: [] });
    expect(await stored()).toMatchObject({ events: null, enabled: false, url: hook.url });

    await run("webhook.delete", { id });
    expect(await stored()).toBeUndefined();
  });
});

describe("space dashboard", () => {
  const spaceId = randomUUID();
  const projectType = `${spaceId}/project`;
  const bugType = `${spaceId}/bug`;
  let admin: { cookie: string; userId: string };
  let stranger: { cookie: string; userId: string };
  const run = (name: string, args: unknown, userId = admin.userId) => services.zero.run(name, args, userId);
  const get = (cookie: string, query = "") =>
    app.request(`/api/spaces/${spaceId}/dashboard${query}`, { headers: { cookie } });

  beforeAll(async () => {
    admin = await signUp(`dash-admin-${spaceId}@example.com`);
    stranger = await signUp(`dash-stranger-${spaceId}@example.com`);
    await run("space.create", { id: spaceId, name: "仪表盘" });
    await run("workItemType.create", { id: projectType, spaceId, key: "project", name: "项目" });
    await run("roleDef.create", { id: `${projectType}/role/pm`, typeId: projectType, key: "pm", name: "PM" });
    await run("flowTemplate.create", { id: `${projectType}/t`, typeId: projectType, key: "t", name: "流程" });
    await run("flowTemplate.saveDraft", {
      templateId: `${projectType}/t`,
      definition: {
        key: "t",
        version: 0,
        nodes: [
          { key: "start", name: "开始", completion: "auto", ownerRoles: [] },
          { key: "plan", name: "立项", completion: "singleConfirm", ownerRoles: ["pm"], stageOnArrival: "立项中" },
        ],
        edges: [{ from: "start", to: "plan" }],
      },
    });
    await run("flowTemplate.publish", { versionId: `${projectType}/t/v1` });
    await run("workItemType.create", { id: bugType, spaceId, key: "bug", name: "缺陷", flowMode: "state" });
    await run("flowTemplate.create", { id: `${bugType}/t`, typeId: bugType, key: "t", name: "流程" });
    await run("flowTemplate.publish", { versionId: `${bugType}/t/v1` });

    for (const name of ["官网改版", "小程序"])
      await run("workItem.create", {
        id: `${spaceId}/${name}`,
        typeId: projectType,
        name,
        roles: { pm: [admin.userId] },
      });
    await run("node.setPlan", {
      workItemId: `${spaceId}/官网改版`,
      nodeKey: "plan",
      start: "2026-01-05",
      end: "2026-01-09",
    });
    for (const name of ["白屏", "闪退"])
      await run("workItem.create", { id: `${spaceId}/${name}`, typeId: bugType, name });
    await run("workItem.transition", { workItemId: `${spaceId}/闪退`, to: "doing" });
    await run("workItem.transition", { workItemId: `${spaceId}/闪退`, to: "done" });
  });

  it("summarizes the space for its members only", async () => {
    expect((await get(stranger.cookie)).status).toBe(404);
    const res = await get(admin.cookie);
    expect(res.status).toBe(200);
    const d = (await res.json()) as Dashboard;
    expect(d.totals).toMatchObject({
      inProgress: 3,
      completed: 1,
      createdLast7Days: 4,
      completedLast7Days: 1,
      overdue: 1,
    });
    expect(d.byStage).toEqual([
      { stage: "立项中", count: 2 },
      { stage: "待处理", count: 1 },
    ]);
    expect(d.byType.map((t) => [t.name, t.count])).toEqual([
      ["项目", 2],
      ["缺陷", 1],
    ]);
    expect(d.weekly).toHaveLength(8);
    expect(d.weekly.at(-1)).toMatchObject({ created: 4, completed: 1 });
    expect(d.overdue).toEqual([
      expect.objectContaining({
        workItemName: "官网改版",
        nodeName: "立项",
        plannedEnd: "2026-01-09",
        owners: [{ userId: admin.userId, name: expect.any(String) }],
      }),
    ]);
    expect(d.load).toEqual([expect.objectContaining({ userId: admin.userId, nodes: 2, overdue: 1 })]);

    const bugs = (await (await get(admin.cookie, `?type=${encodeURIComponent(bugType)}`)).json()) as Dashboard;
    expect(bugs.totals).toMatchObject({ inProgress: 1, completed: 1, overdue: 0 });
  });
});

describe("user groups and type permissions", () => {
  const spaceId = randomUUID();
  const typeId = `${spaceId}/bug`;
  const templateId = `${typeId}/default`;
  const groupId = `${spaceId}/group/qa`;
  let admin: { cookie: string; userId: string };
  let tester: { cookie: string; userId: string };
  let outsider: { cookie: string; userId: string };
  let owner: { cookie: string; userId: string };
  let itemId: string;
  const run = (name: string, args: unknown, userId = admin.userId) => services.zero.run(name, args, userId);
  const comment = (userId: string) =>
    run("comment.create", { id: randomUUID(), workItemId: itemId, body: "看看", mentions: [] }, userId);
  const access = async () =>
    (await services.database.db.select().from(schema.typeAccess).where(eq(schema.typeAccess.typeId, typeId)))
      .map((a) => `${a.userId === tester.userId ? "tester" : a.userId}:${a.level}`)
      .sort();

  beforeAll(async () => {
    admin = await signUp(`ug-admin-${spaceId}@example.com`);
    tester = await signUp(`ug-tester-${spaceId}@example.com`);
    outsider = await signUp(`ug-outsider-${spaceId}@example.com`);
    owner = await signUp(`ug-owner-${spaceId}@example.com`);
    await run("space.create", { id: spaceId, name: "用户组" });
    await services.database.db.insert(schema.spaceMember).values([
      { spaceId, userId: tester.userId },
      { spaceId, userId: outsider.userId },
      { spaceId, userId: owner.userId },
    ]);
    await run("workItemType.create", { id: typeId, spaceId, key: "bug", name: "缺陷" });
    await run("roleDef.create", { id: `${typeId}/role/owner`, typeId, key: "owner", name: "经办人" });
    await run("roleDef.update", { id: `${typeId}/role/owner`, config: { isOwner: true } });
    await run("flowTemplate.create", { id: templateId, typeId, key: "default", name: "流程" });
    await run("flowTemplate.saveDraft", {
      templateId,
      definition: {
        key: "default",
        version: 0,
        nodes: [
          { key: "start", name: "开始", completion: "auto", ownerRoles: [] },
          { key: "fix", name: "修复", completion: "singleConfirm", ownerRoles: ["owner"] },
        ],
        edges: [{ from: "start", to: "fix" }],
      },
    });
    await run("flowTemplate.publish", { versionId: `${templateId}/v1` });
    itemId = randomUUID();
    await run("workItem.create", { id: itemId, typeId, name: "登录闪退", roles: { owner: [owner.userId] } });
  });

  it("manages groups: only admins, only space members, unique names", async () => {
    await expect(run("userGroup.create", { id: groupId, spaceId, name: "测试组" }, tester.userId)).rejects.toThrow(
      "只有空间管理员可以管理用户组",
    );
    await run("userGroup.create", { id: groupId, spaceId, name: "测试组" });
    await expect(run("userGroup.create", { id: randomUUID(), spaceId, name: "测试组" })).rejects.toThrow(
      "已经有叫「测试组」的用户组了",
    );
    const stranger = await signUp(`ug-stranger-${spaceId}@example.com`);
    await expect(run("userGroup.setMembers", { id: groupId, userIds: [stranger.userId] })).rejects.toThrow(
      "用户组成员必须是空间成员",
    );
    await run("userGroup.setMembers", { id: groupId, userIds: [tester.userId] });
  });

  it("limits who sees work items: members see only their own, a group sees all", async () => {
    await run("workItemType.setPermissions", {
      typeId,
      permissions: { view: { members: "involved", [`group:${groupId}`]: "all" } },
    });
    expect(await access()).toEqual(["tester:all"]);
    // 不在组里、也没参与的成员看不到；参与的（经办人）、组里的人、管理员看得到
    await expect(comment(outsider.userId)).rejects.toThrow("工作项不存在或没有权限");
    await comment(owner.userId);
    await comment(tester.userId);
    await comment(admin.userId);

    // 移出用户组后就看不到了
    await run("userGroup.setMembers", { id: groupId, userIds: [] });
    expect(await access()).toEqual([]);
    await expect(comment(tester.userId)).rejects.toThrow("工作项不存在或没有权限");
    await run("userGroup.setMembers", { id: groupId, userIds: [tester.userId] });
  });

  it("refuses roles in the view settings and unknown groups", async () => {
    await expect(
      run("workItemType.setPermissions", { typeId, permissions: { view: { "role:owner": "all" } } }),
    ).rejects.toThrow("查看范围只能按空间成员和用户组设置");
    await expect(
      run("workItemType.setPermissions", { typeId, permissions: { view: { "group:nope": "all" } } }),
    ).rejects.toThrow("用户组不存在");
    await expect(run("workItemType.setPermissions", { typeId, permissions: null }, tester.userId)).rejects.toThrow(
      "只有空间管理员可以修改权限",
    );
  });

  it("grants and denies operations: deny wins, roles count on the item, defaults stay when unset", async () => {
    // 没配：只有经办人（负责人角色）能冻结
    await expect(run("workItem.setFrozen", { workItemId: itemId, frozen: true }, tester.userId)).rejects.toThrow(
      "你没有权限冻结工作项",
    );
    // 用户组允许冻结，空间成员禁止新建，经办人角色禁止终止
    await run("workItemType.setPermissions", {
      typeId,
      permissions: {
        view: { members: "all" },
        ops: {
          freeze: { [`group:${groupId}`]: "allow" },
          create: { members: "deny", [`group:${groupId}`]: "allow" },
          terminate: { "role:owner": "deny", members: "allow" },
        },
      },
    });
    await run("workItem.setFrozen", { workItemId: itemId, frozen: true }, tester.userId);
    await run("workItem.setFrozen", { workItemId: itemId, frozen: false }, tester.userId);
    // 配了冻结规则后，没被授权的负责人也不能冻结了
    await expect(run("workItem.setFrozen", { workItemId: itemId, frozen: true }, owner.userId)).rejects.toThrow(
      "你没有权限冻结工作项",
    );
    // 禁止优先：组里的人也是空间成员，空间成员被禁止新建
    await expect(
      run("workItem.create", { id: randomUUID(), typeId, name: "新缺陷", roles: {} }, tester.userId),
    ).rejects.toThrow("你没有权限新建缺陷");
    // 经办人被禁止终止，其他成员允许
    await expect(run("workItem.terminate", { workItemId: itemId }, owner.userId)).rejects.toThrow(
      "你没有权限终止工作项",
    );
    await run("workItem.terminate", { workItemId: itemId }, outsider.userId);
    await run("workItem.restore", { workItemId: itemId }, outsider.userId);
    // 管理员不受限制
    await run("workItem.create", { id: randomUUID(), typeId, name: "管理员建的", roles: {} });
  });

  it("hides a type from members when nobody may see it, and drops a deleted group's grants", async () => {
    await run("workItemType.setPermissions", {
      typeId,
      permissions: { view: { members: "none", [`group:${groupId}`]: "involved" } },
    });
    await expect(
      run("workItem.create", { id: randomUUID(), typeId, name: "看不到的", roles: {} }, outsider.userId),
    ).rejects.toThrow("你没有权限新建缺陷");
    expect(await access()).toEqual(["tester:involved"]);
    await run("userGroup.delete", { id: groupId });
    expect(await access()).toEqual([]);
    const [type] = await services.database.db
      .select()
      .from(schema.workItemType)
      .where(eq(schema.workItemType.id, typeId));
    expect(type?.permissions?.view).toEqual({ members: "none" });
    expect(type?.viewBase).toBe("none");
  });
});

describe("vote fields", () => {
  const spaceId = randomUUID();
  const typeId = `${spaceId}/task`;
  const templateId = `${typeId}/default`;
  let admin: { cookie: string; userId: string };
  let member: { cookie: string; userId: string };
  let itemId: string;
  const run = (name: string, args: unknown, userId = admin.userId) => services.zero.run(name, args, userId);
  const summary = async (fieldKey: string) =>
    (
      await services.database.db
        .select()
        .from(schema.fieldValue)
        .where(and(eq(schema.fieldValue.workItemId, itemId), eq(schema.fieldValue.fieldKey, fieldKey)))
    )[0]?.value;
  const ballots = (fieldKey: string) =>
    services.database.db
      .select()
      .from(schema.voteBallot)
      .where(and(eq(schema.voteBallot.workItemId, itemId), eq(schema.voteBallot.fieldKey, fieldKey)));

  beforeAll(async () => {
    admin = await signUp(`vote-admin-${spaceId}@example.com`);
    member = await signUp(`vote-member-${spaceId}@example.com`);
    await run("space.create", { id: spaceId, name: "投票" });
    await services.database.db.insert(schema.spaceMember).values({ spaceId, userId: member.userId });
    await run("workItemType.create", { id: typeId, spaceId, key: "task", name: "任务", flowMode: "state" });
    // 不给选项：默认表态（赞成 / 反对 / 弃权）
    await run("fieldDef.create", { id: `${typeId}/field/立项`, typeId, key: "立项", name: "立项", dataType: "vote" });
    await run("fieldDef.create", {
      id: `${typeId}/field/方案`,
      typeId,
      key: "方案",
      name: "方案",
      dataType: "vote",
      options: [
        { value: "A", label: "A", score: 3 },
        { value: "B", label: "B", score: 1 },
      ],
    });
    await run("flowTemplate.create", { id: templateId, typeId, key: "default", name: "流程" });
    await run("flowTemplate.publish", { versionId: `${templateId}/v1` });
    itemId = randomUUID();
    await run("workItem.create", { id: itemId, typeId, name: "新功能" });
  });

  it("defaults to stance options and records ballots and a voter summary", async () => {
    const [def] = await services.database.db
      .select()
      .from(schema.fieldDef)
      .where(eq(schema.fieldDef.id, `${typeId}/field/立项`));
    expect(def?.options?.map((o) => o.value)).toEqual(["赞成", "反对", "弃权"]);
    expect(def?.config).toMatchObject({ vote: { mode: "stance" } });

    await expect(run("fieldValue.set", { workItemId: itemId, fieldKey: "立项", value: "赞成" })).rejects.toThrow(
      "要在字段上投票",
    );
    await expect(run("vote.cast", { workItemId: itemId, fieldKey: "立项", choices: ["赞成", "反对"] })).rejects.toThrow(
      "只能选一项",
    );
    await run("vote.cast", { workItemId: itemId, fieldKey: "立项", choices: ["赞成"], remark: "值得做" });
    await run("vote.cast", { workItemId: itemId, fieldKey: "立项", choices: ["反对"] }, member.userId);
    // 改票：还是一张票
    await run("vote.cast", { workItemId: itemId, fieldKey: "立项", choices: ["弃权"] }, member.userId);
    expect(await summary("立项")).toEqual({ voters: [admin.userId, member.userId], revealed: false });
    const rows = await ballots("立项");
    expect(rows.map((r) => [r.userId, r.choices, r.remark, r.revealed]).sort()).toEqual(
      [
        [admin.userId, ["赞成"], "值得做", true],
        [member.userId, ["弃权"], null, true],
      ].sort(),
    );
    // 非盲投不能放榜
    await expect(run("vote.reveal", { workItemId: itemId, fieldKey: "立项", revealed: true })).rejects.toThrow(
      "不是盲投",
    );
  });

  it("keeps blind ballots hidden until an admin or reveal role publishes them", async () => {
    await run("fieldDef.update", {
      id: `${typeId}/field/方案`,
      name: "方案",
      required: false,
      config: { vote: { mode: "multi", remark: "required", blind: true } },
    });
    await expect(run("vote.cast", { workItemId: itemId, fieldKey: "方案", choices: ["A"] })).rejects.toThrow(
      "请填写投票备注",
    );
    await expect(
      run("vote.cast", { workItemId: itemId, fieldKey: "方案", choices: ["C"], remark: "x" }),
    ).rejects.toThrow("没有选项「C」");
    await run("vote.cast", { workItemId: itemId, fieldKey: "方案", choices: ["A", "B"], remark: "都行" });
    await run("vote.cast", { workItemId: itemId, fieldKey: "方案", choices: ["A"], remark: "A 好" }, member.userId);
    expect((await ballots("方案")).every((b) => b.revealed === false)).toBe(true);

    // 成员没有放榜权限；管理员放榜后票都公开，之后再投的也公开
    await expect(
      run("vote.reveal", { workItemId: itemId, fieldKey: "方案", revealed: true }, member.userId),
    ).rejects.toThrow("没有放榜权限");
    await run("vote.reveal", { workItemId: itemId, fieldKey: "方案", revealed: true });
    expect((await ballots("方案")).every((b) => b.revealed === true)).toBe(true);
    expect(await summary("方案")).toMatchObject({ revealed: true });
    await run("vote.cast", { workItemId: itemId, fieldKey: "方案", choices: ["B"], remark: "改主意" }, member.userId);
    expect((await ballots("方案")).find((b) => b.userId === member.userId)).toMatchObject({
      choices: ["B"],
      revealed: true,
    });
    const kinds = (
      await services.database.db.select().from(schema.eventLog).where(eq(schema.eventLog.workItemId, itemId))
    ).map((e) => e.kind);
    expect(kinds).toEqual(expect.arrayContaining(["voteCast", "voteRevealed"]));
  });
});

describe("multi-person fields", () => {
  const spaceId = randomUUID();
  const typeId = `${spaceId}/task`;
  const templateId = `${typeId}/default`;
  let admin: { cookie: string; userId: string };
  let dev: { cookie: string; userId: string };
  let qa: { cookie: string; userId: string };
  let itemId: string;
  const run = (name: string, args: unknown, userId = admin.userId) => services.zero.run(name, args, userId);
  const set = (fieldKey: string, value: unknown, userId: string) =>
    run("fieldValue.set", { workItemId: itemId, fieldKey, value }, userId);
  const storedValue = async (fieldKey: string) =>
    (
      await services.database.db
        .select()
        .from(schema.fieldValue)
        .where(and(eq(schema.fieldValue.workItemId, itemId), eq(schema.fieldValue.fieldKey, fieldKey)))
    )[0]?.value;
  const columns = [{ key: "结论", name: "结论", dataType: "text" }];

  beforeAll(async () => {
    admin = await signUp(`mp-admin-${spaceId}@example.com`);
    dev = await signUp(`mp-dev-${spaceId}@example.com`);
    qa = await signUp(`mp-qa-${spaceId}@example.com`);
    await run("space.create", { id: spaceId, name: "多人复合" });
    await services.database.db.insert(schema.spaceMember).values([
      { spaceId, userId: dev.userId },
      { spaceId, userId: qa.userId },
    ]);
    await run("workItemType.create", { id: typeId, spaceId, key: "task", name: "任务", flowMode: "state" });
    await run("roleDef.create", { id: `${typeId}/role/dev`, typeId, key: "dev", name: "开发" });
    for (const key of ["评审", "自评"])
      await run("fieldDef.create", { id: `${typeId}/field/${key}`, typeId, key, name: key, dataType: "multiPerson" });
    await run("fieldDef.update", {
      id: `${typeId}/field/评审`,
      name: "评审",
      config: { columns, people: { role: "dev" } },
    });
    await run("fieldDef.update", { id: `${typeId}/field/自评`, name: "自评", config: { columns } });
    await expect(
      run("fieldDef.update", { id: `${typeId}/field/自评`, name: "自评", config: { columns, people: { role: "pm" } } }),
    ).rejects.toThrow("角色「pm」不存在");
    await run("flowTemplate.create", { id: templateId, typeId, key: "default", name: "流程" });
    await run("flowTemplate.publish", { versionId: `${templateId}/v1` });
    itemId = randomUUID();
    await run("workItem.create", { id: itemId, typeId, name: "登录改版", roles: { dev: [dev.userId] } });
  });

  it("lets each person fill only their own group", async () => {
    await set("自评", [{ _user: dev.userId, 结论: "能做" }], dev.userId);
    // 不能替别人填，也不能改别人的行
    await expect(
      set(
        "自评",
        [
          { _user: dev.userId, 结论: "能做" },
          { _user: admin.userId, 结论: "x" },
        ],
        qa.userId,
      ),
    ).rejects.toThrow("只能填写自己的一组");
    await expect(set("自评", [{ _user: dev.userId, 结论: "改了" }], qa.userId)).rejects.toThrow("只能填写自己的一组");
    await set(
      "自评",
      [
        { _user: dev.userId, 结论: "能做" },
        { _user: qa.userId, 结论: "要测" },
      ],
      qa.userId,
    );
    // 管理员可以改任何一行
    await set(
      "自评",
      [
        { _user: dev.userId, 结论: "能做" },
        { _user: qa.userId, 结论: "已测" },
      ],
      admin.userId,
    );
    expect(await storedValue("自评")).toEqual([
      { _user: dev.userId, 结论: "能做" },
      { _user: qa.userId, 结论: "已测" },
    ]);
    await expect(set("自评", [{ _user: "nobody", 结论: "x" }], admin.userId)).rejects.toThrow("空间成员");
  });

  it("limits a role-based field to the role's people", async () => {
    await set("评审", [{ _user: dev.userId, 结论: "通过" }], dev.userId);
    await expect(set("评审", [{ _user: qa.userId, 结论: "通过" }], admin.userId)).rejects.toThrow(
      "只能由对应角色的人填写",
    );
    expect(await storedValue("评审")).toEqual([{ _user: dev.userId, 结论: "通过" }]);
  });
});

describe("metric charts", () => {
  const spaceId = randomUUID();
  const typeId = `${spaceId}/task`;
  let admin: { cookie: string; userId: string };
  let member: { cookie: string; userId: string };
  let guest: { cookie: string; userId: string };
  const run = (name: string, args: unknown, userId = admin.userId) => services.zero.run(name, args, userId);
  const chartsOf = () =>
    services.database.db
      .select()
      .from(schema.metricChart)
      .where(eq(schema.metricChart.spaceId, spaceId))
      .orderBy(schema.metricChart.sort);

  beforeAll(async () => {
    admin = await signUp(`chart-admin-${spaceId}@example.com`);
    member = await signUp(`chart-member-${spaceId}@example.com`);
    guest = await signUp(`chart-guest-${spaceId}@example.com`);
    await run("space.create", { id: spaceId, name: "度量" });
    await services.database.db.insert(schema.spaceMember).values([
      { spaceId, userId: member.userId },
      { spaceId, userId: guest.userId, role: "guest" },
    ]);
    await run("workItemType.create", { id: typeId, spaceId, key: "task", name: "任务", flowMode: "state" });
    await run("fieldDef.create", { id: `${typeId}/field/工时`, typeId, key: "工时", name: "工时", dataType: "number" });
    await run("fieldDef.create", { id: `${typeId}/field/备注`, typeId, key: "备注", name: "备注", dataType: "text" });
  });

  it("saves charts for members, checks the config, and only the creator or an admin can change them", async () => {
    const config = { kind: "column", dimension: { by: "status" }, metric: { agg: "sum", field: "工时" } };
    await run(
      "chart.create",
      { id: "c1", spaceId, name: "工时", filter: { typeIds: [typeId] }, config },
      member.userId,
    );
    await run(
      "chart.create",
      { id: "c2", spaceId, name: "数量", filter: {}, config: { kind: "indicator", metric: { agg: "count" } } },
      admin.userId,
    );
    expect((await chartsOf()).map((c) => [c.id, c.sort, c.createdBy])).toEqual([
      ["c1", 0, member.userId],
      ["c2", 1, admin.userId],
    ]);
    await expect(
      run("chart.create", {
        id: "c3",
        spaceId,
        name: "x",
        filter: {},
        config: { kind: "column", metric: { agg: "sum", field: "备注" } },
      }),
    ).rejects.toThrow("不是数字字段");
    await expect(
      run("chart.create", { id: "c4", spaceId, name: "x", filter: {}, config }, guest.userId),
    ).rejects.toThrow("访客");
    // 成员不能改别人的图表；管理员可以
    await expect(run("chart.update", { id: "c2", name: "改" }, member.userId)).rejects.toThrow("创建人或空间管理员");
    await run("chart.update", { id: "c1", name: "工时汇总", config: { ...config, kind: "bar" } }, admin.userId);
    await run("chart.reorder", { spaceId, ids: ["c2", "c1"] }, member.userId);
    expect((await chartsOf()).map((c) => [c.id, c.name, c.config.kind])).toEqual([
      ["c2", "数量", "indicator"],
      ["c1", "工时汇总", "bar"],
    ]);
    // 放到仪表盘：同样只有创建人或管理员
    await expect(run("chart.update", { id: "c2", onDashboard: true }, member.userId)).rejects.toThrow(
      "创建人或空间管理员",
    );
    await run("chart.update", { id: "c2", onDashboard: true }, admin.userId);
    expect((await chartsOf()).find((c) => c.id === "c2")?.onDashboard).toBe(true);
    await expect(run("chart.delete", { id: "c2" }, member.userId)).rejects.toThrow("创建人或空间管理员");
    await run("chart.delete", { id: "c1" }, member.userId);
    expect((await chartsOf()).map((c) => c.id)).toEqual(["c2"]);
  });
});

describe("hierarchies", () => {
  const spaceId = randomUUID();
  const project = `${spaceId}/project`;
  const story = `${spaceId}/story`;
  const task = `${spaceId}/task`;
  let admin: { cookie: string; userId: string };
  let member: { cookie: string; userId: string };
  const run = (name: string, args: unknown, userId = admin.userId) => services.zero.run(name, args, userId);

  beforeAll(async () => {
    admin = await signUp(`hier-admin-${spaceId}@example.com`);
    member = await signUp(`hier-member-${spaceId}@example.com`);
    await run("space.create", { id: spaceId, name: "层级" });
    await services.database.db.insert(schema.spaceMember).values([{ spaceId, userId: member.userId }]);
    for (const [id, key, name] of [
      [project, "project", "项目"],
      [story, "story", "需求"],
      [task, "task", "任务"],
    ] as const)
      await run("workItemType.create", { id, spaceId, key, name });
    // 项目 → 需求；任务 → 需求（从需求往任务走是反方向）；需求 → 需求（子需求）
    await run("relationDef.create", {
      id: `${spaceId}/r1`,
      fromTypeId: project,
      toTypeId: story,
      name: "包含需求",
      cardinality: "many",
    });
    await run("relationDef.create", {
      id: `${spaceId}/r2`,
      fromTypeId: task,
      toTypeId: story,
      name: "所属需求",
      cardinality: "one",
    });
    await run("relationDef.create", {
      id: `${spaceId}/r3`,
      fromTypeId: story,
      toTypeId: story,
      name: "子需求",
      cardinality: "many",
    });
  });

  const rows = () => services.database.db.select().from(schema.hierarchy).where(eq(schema.hierarchy.spaceId, spaceId));

  it("an admin builds a tree layer by layer, following relations either way, with a repeating layer", async () => {
    const id = randomUUID();
    await run("hierarchy.create", { id, spaceId, name: "项目树", rootTypeId: project, layers: [] });
    await run("hierarchy.update", {
      id,
      layers: [
        { typeId: story, relationDefId: `${spaceId}/r1` },
        { typeId: story, relationDefId: `${spaceId}/r3`, repeat: true },
        { typeId: task, relationDefId: `${spaceId}/r2`, reverse: true },
      ],
    });
    const [row] = (await rows()).filter((h) => h.id === id);
    expect(row?.layers).toEqual([
      { typeId: story, relationDefId: `${spaceId}/r1` },
      { typeId: story, relationDefId: `${spaceId}/r3`, repeat: true },
      { typeId: task, relationDefId: `${spaceId}/r2`, reverse: true },
    ]);
    // 用到的关系不能删
    await expect(run("relationDef.delete", { id: `${spaceId}/r2` })).rejects.toThrow("层级「项目树」用到了这条关系");
    await run("hierarchy.update", { id, name: "项目拆解" });
    await run("hierarchy.delete", { id });
    expect(await rows()).toHaveLength(0);
  });

  it("rejects layers that the previous layer can't reach, and non-admins", async () => {
    // 项目和任务之间没有关系
    await expect(
      run("hierarchy.create", {
        id: randomUUID(),
        spaceId,
        name: "错的",
        rootTypeId: project,
        layers: [{ typeId: task, relationDefId: `${spaceId}/r2` }],
      }),
    ).rejects.toThrow("第 2 层和上一层之间没有这条关系");
    // 方向反了：所属需求是 任务 → 需求，从需求往任务要走反方向
    await expect(
      run("hierarchy.create", {
        id: randomUUID(),
        spaceId,
        name: "错的",
        rootTypeId: story,
        layers: [{ typeId: task, relationDefId: `${spaceId}/r2` }],
      }),
    ).rejects.toThrow("第 2 层和上一层之间没有这条关系");
    await expect(
      run(
        "hierarchy.create",
        { id: randomUUID(), spaceId, name: "成员的", rootTypeId: project, layers: [] },
        member.userId,
      ),
    ).rejects.toThrow("只有空间管理员");
    expect(await rows()).toHaveLength(0);
  });
});
