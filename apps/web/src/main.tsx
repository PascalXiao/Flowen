// 必须最先引入：给 Semi 注入 React 19 的 createRoot（Toast、Modal 等靠它挂载）。
import "@douyinfe/semi-ui/react19-adapter";
import { RouterProvider } from "@tanstack/react-router";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "@xyflow/react/dist/style.css";
import "./index.css";
import { Toaster } from "./components/ui/toast.tsx";
import { initTheme } from "./lib/theme.ts";
import { router } from "./router.tsx";

initTheme();

const root = document.getElementById("root");
if (!root) throw new Error("缺少 #root 节点");

createRoot(root).render(
  <StrictMode>
    <RouterProvider router={router} />
    <Toaster />
  </StrictMode>,
);
