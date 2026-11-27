import { randomUUID } from "node:crypto";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { schema } from "@fp/db";
import { createTestDatabase } from "@fp/db/testing";
import { demoSample } from "@fp/engine";
import type { AuditEntry } from "@fp/sync";
import { and, eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createApp, createServices, type Services } from "../src/app.ts";
import { importDemoTemplate } from "../src/seed/demo.ts";

let services: Services;
let app: ReturnType<typeof createApp>;

beforeAll(async () => {
  services = createServices(
    await createTestDatabase("fp_test_space_admin"),
    await mkdtemp(join(tmpdir(), "fp-files-")),
  );
  app = createApp(services);
});

afterAll(() => services?.database.close());

type User = { cookie: string; userId: string };

async function signUp(email: string): Promise<User> {
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

const post = (path: string, user: User, body: unknown) =>
  app.request(path, {
    method: "POST",
    headers: { "content-type": "application/json", cookie: user.cookie },
    body: JSON.stringify(body),
  });

const audit = async (user: User, query = "") => {
  const res = await app.request(`/api/audit${query}`, { headers: { cookie: user.cookie } });
  return { status: res.status, body: (await res.json()) as { entries: AuditEntry[]; next: number | null } };
};

describe("org admins, space templates, copy space and the audit log", () => {
  const source = randomUUID();
  let boss: User;
  let pm: User;
  let dev: User;
  let typeId: string;
  let itemId: string;
  let templateId: string;

  beforeAll(async () => {
    boss = await signUp("boss@example.com");
    pm = await signUp("pm@example.com");
    dev = await signUp("dev@example.com");
    await services.zero.run("space.create", { id: source, name: "源空间" }, pm.userId);
    await services.database.db.insert(schema.spaceMember).values({ spaceId: source, userId: dev.userId });
    ({ typeId } = await importDemoTemplate(services.database.db, source));
    const { F } = demoSample;
    itemId = randomUUID();
    await services.zero.run(
      "workItem.create",
      {
        id: itemId,
        typeId,
        name: "示例项目",
        fields: {
          [F.needPhaseOut]: "是",
          [F.needLaunchPlan]: "是",
          [F.needResearch]: "否",
          [F.needVideo]: "是",
          [F.needCert]: "是",
        },
        roles: { NPD: [pm.userId], 开发: [dev.userId] },
      },
      pm.userId,
    );
    const groupId = randomUUID();
    await services.zero.run("userGroup.create", { id: groupId, spaceId: source, name: "研发组" }, pm.userId);
    await services.zero.run("userGroup.setMembers", { id: groupId, userIds: [dev.userId] }, pm.userId);
    await services.zero.run(
      "workItemType.setPermissions",
      { typeId, permissions: { view: { members: "involved", [`group:${groupId}`]: "all" } } },
      pm.userId,
    );
    await services.zero.run(
      "view.create",
      { id: randomUUID(), spaceId: source, name: "我的项目", filter: { typeIds: [typeId] } },
      pm.userId,
    );
  });

  it("makes the first person to sign up an org admin", async () => {
    const admins = await services.database.db.select().from(schema.orgAdmin);
    expect(admins.map((a) => a.userId)).toEqual([boss.userId]);
    await expect(services.zero.run("org.setAdmin", { userId: pm.userId, admin: true }, pm.userId)).rejects.toThrow(
      "只有企业管理员",
    );
    await expect(services.zero.run("org.setAdmin", { userId: boss.userId, admin: false }, boss.userId)).rejects.toThrow(
      "至少要有一个",
    );
  });

  it("saves a space as a template; only org admins may publish org templates", async () => {
    const includes = { views: true, charts: false, items: true };
    let res = await post("/api/space-templates", dev, { spaceId: source, name: "x", includes });
    expect(res.status).toBe(403);
    res = await post("/api/space-templates", pm, { spaceId: source, name: "x", scope: "org", includes });
    expect(res.status).toBe(403);
    res = await post("/api/space-templates", pm, { spaceId: source, name: "新品模板", includes });
    expect(res.status).toBe(201);
    const body = (await res.json()) as {
      id: string;
      summary: { types: { name: string }[]; items: number; views: string[] };
    };
    templateId = body.id;
    expect(body.summary).toMatchObject({ types: [{ name: "项目" }], items: 1, views: ["我的项目"] });
  });

  it("creates a space from a personal template only for its creator", async () => {
    const denied = await post("/api/spaces/from-template", dev, { templateId, name: "偷用" });
    expect(denied.status).toBe(404);
    const res = await post("/api/spaces/from-template", pm, { templateId, name: "新品二期" });
    expect(res.status).toBe(201);
    const { id } = (await res.json()) as { id: string };
    const { db } = services.database;
    const types = await db.select().from(schema.workItemType).where(eq(schema.workItemType.spaceId, id));
    expect(types.map((t) => [t.name, t.id])).toEqual([["项目", `${id}/project`]]);
    // 权限里的用户组跟着换了 id，组是空的
    const [group] = await db.select().from(schema.userGroup).where(eq(schema.userGroup.spaceId, id));
    expect(types[0]?.permissions?.view).toEqual({ members: "involved", [`group:${group?.id}`]: "all" });
    // 工作项带过来了，不是新空间成员的人从角色里去掉
    const items = await db.select().from(schema.workItem).where(eq(schema.workItem.spaceId, id));
    expect(items).toHaveLength(1);
    expect(items[0]?.id).not.toBe(itemId);
    expect(items[0]?.flowVersionId?.startsWith(id)).toBe(true);
    const roles = await db
      .select()
      .from(schema.roleMember)
      .where(eq(schema.roleMember.workItemId, items[0]?.id ?? ""));
    expect([...new Set(roles.map((r) => r.userId))]).toEqual([pm.userId]);
    const nodes = await db
      .select()
      .from(schema.nodeInstance)
      .where(eq(schema.nodeInstance.workItemId, items[0]?.id ?? ""));
    expect(nodes).toHaveLength(48);
    expect(nodes.flatMap((n) => n.owners)).not.toContain(dev.userId);
    const members = await db.select().from(schema.spaceMember).where(eq(schema.spaceMember.spaceId, id));
    expect(members.map((m) => [m.userId, m.role])).toEqual([[pm.userId, "admin"]]);
    // 源空间原样不动
    const original = await db.select().from(schema.roleMember).where(eq(schema.roleMember.workItemId, itemId));
    expect([...new Set(original.map((r) => r.userId))].sort()).toEqual([pm.userId, dev.userId].sort());
  });

  it("copies a space's configuration, optionally with its members", async () => {
    const res = await post(`/api/spaces/${source}/copy`, pm, { name: "源空间 副本", members: true });
    expect(res.status).toBe(201);
    const { id } = (await res.json()) as { id: string };
    const { db } = services.database;
    expect(await db.$count(schema.workItem, eq(schema.workItem.spaceId, id))).toBe(0);
    const members = await db.select().from(schema.spaceMember).where(eq(schema.spaceMember.spaceId, id));
    expect(members.map((m) => [m.userId, m.role]).sort()).toEqual(
      [
        [pm.userId, "admin"],
        [dev.userId, "member"],
      ].sort(),
    );
    const [group] = await db.select().from(schema.userGroup).where(eq(schema.userGroup.spaceId, id));
    const groupMembers = await db
      .select()
      .from(schema.userGroupMember)
      .where(eq(schema.userGroupMember.groupId, group?.id ?? ""));
    expect(groupMembers.map((m) => m.userId)).toEqual([dev.userId]);
    const access = await db
      .select()
      .from(schema.typeAccess)
      .where(eq(schema.typeAccess.typeId, `${id}/project`));
    expect(access).toEqual([{ typeId: `${id}/project`, userId: dev.userId, level: "all" }]);
    const views = await db.select().from(schema.savedView).where(eq(schema.savedView.spaceId, id));
    expect(views.map((v) => v.filter)).toEqual([{ typeIds: [`${id}/project`] }]);

    const denied = await post(`/api/spaces/${source}/copy`, dev, { name: "x" });
    expect(denied.status).toBe(403);
  });

  it("publishes an org template, which everyone can then use", async () => {
    await services.zero.run(
      "spaceTemplate.update",
      { id: templateId, name: "新品模板", description: "标准流程", scope: "org" },
      boss.userId,
    );
    const res = await post("/api/spaces/from-template", dev, { templateId, name: "开发的空间" });
    expect(res.status).toBe(201);
    await expect(services.zero.run("spaceTemplate.delete", { id: templateId }, dev.userId)).rejects.toThrow(
      "只有模板的创建人",
    );
  });

  it("records config, member and space operations in the audit log", async () => {
    const forbidden = await audit(dev);
    expect(forbidden.status).toBe(403);
    // 空间管理员只能看自己空间的
    const mine = await audit(pm, `?spaceId=${source}`);
    expect(mine.status).toBe(200);
    expect(mine.body.entries.map((e) => e.action).reverse()).toEqual([
      "space.create",
      "userGroup.create",
      "userGroup.setMembers",
      "workItemType.setPermissions",
      "view.create",
      "spaceTemplate.create",
    ]);
    const group = mine.body.entries.find((e) => e.action === "userGroup.setMembers");
    expect(group).toMatchObject({ actorName: "pm", spaceName: "源空间", targetName: "研发组", category: "member" });

    const all = await audit(boss, "?category=space");
    expect(all.body.entries.map((e) => e.action)).toEqual([
      "space.createFromTemplate",
      "space.copy",
      "space.createFromTemplate",
      "space.create",
    ]);
    const logins = await audit(boss, `?actor=${dev.userId}&category=account`);
    expect(logins.body.entries.map((e) => e.action)).toEqual(["account.login", "account.signUp"]);
    const page = await audit(boss, "?limit=2");
    expect(page.body.entries).toHaveLength(2);
    expect(page.body.next).toBe(page.body.entries[1]?.id);
    const search = await audit(boss, `?q=${encodeURIComponent("复制空间")}`);
    expect(search.body.entries.map((e) => e.action)).toEqual(["space.copy"]);
  });
});

describe("teams", () => {
  let admin: User;
  let lead: User;
  let member: User;
  const rd = randomUUID();
  const fe = randomUUID();

  beforeAll(async () => {
    [admin] = await services.database.db
      .select({ userId: schema.orgAdmin.userId })
      .from(schema.orgAdmin)
      .then((rows) => rows.map((r) => ({ userId: r.userId, cookie: "" })));
    lead = await signUp("lead@example.com");
    member = await signUp("member@example.com");
  });

  it("lets anyone create a team and become its admin; parents must not form a cycle", async () => {
    await services.zero.run("team.create", { id: rd, name: "研发", members: [lead.userId] }, lead.userId);
    await services.zero.run(
      "team.create",
      { id: fe, name: "前端", parentIds: [rd], members: [member.userId] },
      lead.userId,
    );
    const [team] = await services.database.db.select().from(schema.team).where(eq(schema.team.id, rd));
    expect(team).toMatchObject({ admins: [lead.userId], parentIds: [], spaceIds: null });
    await expect(
      services.zero.run("team.update", { id: rd, name: "研发", parentIds: [fe], admins: [lead.userId] }, lead.userId),
    ).rejects.toThrow("成环");
    await expect(
      services.zero.run("team.setMembers", { id: rd, userIds: [member.userId] }, member.userId),
    ).rejects.toThrow("只有团队管理员");
  });

  it("org admins manage any team; deleting a team detaches its children", async () => {
    await services.zero.run("team.setMembers", { id: rd, userIds: [lead.userId, member.userId] }, admin?.userId ?? "");
    await services.zero.run("team.delete", { id: rd }, admin?.userId ?? "");
    const [child] = await services.database.db.select().from(schema.team).where(eq(schema.team.id, fe));
    expect(child?.parentIds).toEqual([]);
    const rows = await services.database.db
      .select()
      .from(schema.teamMember)
      .where(and(eq(schema.teamMember.teamId, rd)));
    expect(rows).toEqual([]);
  });
});
