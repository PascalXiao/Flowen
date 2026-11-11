import { demoSample } from "@fp/engine";
import { afterAll, describe, expect, it } from "vitest";
import { createApp, createServices } from "./app.ts";

// 这里的接口不碰数据库；连接是懒建立的，所以给一个不存在的地址也没关系
const services = createServices("postgresql://unused:unused@localhost:1/unused");
const app = createApp(services);
afterAll(() => services.database.close());

describe("api", () => {
  it("validates the demo flow", async () => {
    const res = await app.request("/api/flows/validate", { method: "POST", body: JSON.stringify(demoSample.demoFlow) });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { errors: string[]; warnings: string[] };
    expect(body.errors).toEqual([]);
    expect(body.warnings.some((w) => w.includes("物料成本初步核算"))).toBe(true);
  });

  it("rejects a body that is not a flow", async () => {
    const res = await app.request("/api/flows/validate", { method: "POST", body: "{}" });
    expect(res.status).toBe(400);
  });
});
