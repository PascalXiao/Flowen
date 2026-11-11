import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { connect, type Database } from "../src/client.ts";
import { appendEvents, OUTBOX_CHANNEL } from "../src/events.ts";
import { eventLog, outbox, space, user, workItem, workItemType } from "../src/schema.ts";
import { createTestDatabase } from "../src/testing.ts";

let database: Database;

beforeAll(async () => {
  database = connect(await createTestDatabase("fp_test_db"));
  await database.db.insert(user).values({ id: "u1", name: "Pascal", email: "pascal@example.com" });
  await database.db.insert(space).values({ id: "s1", name: "测试空间" });
  await database.db.insert(workItemType).values({ id: "t1", spaceId: "s1", key: "project", name: "项目" });
  await database.db
    .insert(workItem)
    .values({ id: "w1", spaceId: "s1", typeId: "t1", name: "示例项目", createdBy: "u1" });
});

afterAll(() => database?.close());

describe("appendEvents", () => {
  it("writes event_log and outbox in the caller's transaction and notifies on commit", async () => {
    const notifications: string[] = [];
    const listener = await database.sql.listen(OUTBOX_CHANNEL, (payload) => notifications.push(payload));

    const ids = await database.db.transaction(async (tx) => {
      await tx.update(workItem).set({ stage: "概念" }).where(eq(workItem.id, "w1"));
      const ids = await appendEvents(tx, [
        { spaceId: "s1", workItemId: "w1", kind: "stageChanged", payload: { to: "概念" }, actor: "u1" },
        { spaceId: "s1", kind: "ruleUpdated", payload: {} },
      ]);
      expect(notifications).toEqual([]);
      return ids;
    });

    const rows = await database.db.select().from(outbox).orderBy(outbox.id);
    expect(rows.map((r) => [r.eventId, r.stream, r.dispatchedAt])).toEqual([
      [ids[0], "work_item:w1", null],
      [ids[1], "space:s1", null],
    ]);
    await expect.poll(() => notifications.length).toBe(1);
    await listener.unlisten();
  });

  it("leaves nothing behind when the transaction rolls back", async () => {
    const before = await database.db.$count(eventLog);
    await expect(
      database.db.transaction(async (tx) => {
        await appendEvents(tx, [{ spaceId: "s1", workItemId: "w1", kind: "x", payload: {} }]);
        throw new Error("业务校验失败");
      }),
    ).rejects.toThrow("业务校验失败");
    expect(await database.db.$count(eventLog)).toBe(before);
    expect(await database.db.$count(outbox)).toBe(2);
  });
});
