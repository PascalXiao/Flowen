// 临时：本机预览用，把接口转给 docker 里跑着的 Flowen（http://localhost）。验证完删除。
import { defineConfig, mergeConfig } from "vite";
import base from "./vite.config";

const target = "http://localhost";
const p = { target, changeOrigin: true, headers: { origin: target } };
export default mergeConfig(
  base,
  defineConfig({
    server: { port: 5199, proxy: { "/api": p, "/open-api": p, "/zero": { ...p, ws: true } } },
  }),
);
