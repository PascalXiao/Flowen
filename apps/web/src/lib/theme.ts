import { useSyncExternalStore } from "react";

/** 外观：浅色、深色，或跟随系统。选择记在浏览器里，默认跟随系统。 */
export type ThemeMode = "light" | "dark" | "system";

const KEY = "flowen-theme";
const listeners = new Set<() => void>();
const systemDark = () => window.matchMedia("(prefers-color-scheme: dark)");

export function getThemeMode(): ThemeMode {
  const saved = localStorage.getItem(KEY);
  return saved === "light" || saved === "dark" ? saved : "system";
}

/** 当前实际显示的是浅色还是深色。 */
export function resolvedTheme(): "light" | "dark" {
  const mode = getThemeMode();
  return mode === "system" ? (systemDark().matches ? "dark" : "light") : mode;
}

/** 把外观写到页面上：<html data-theme> 给自己的令牌用，body 上的 theme-mode 给迁移期间还在用的 Semi 组件用。 */
export function applyTheme() {
  const theme = resolvedTheme();
  document.documentElement.dataset.theme = theme;
  document.body?.setAttribute("theme-mode", theme);
  for (const notify of listeners) notify();
}

export function setThemeMode(mode: ThemeMode) {
  if (mode === "system") localStorage.removeItem(KEY);
  else localStorage.setItem(KEY, mode);
  applyTheme();
}

/** 启动时调用一次：应用外观，并在系统外观变化时跟着变。 */
export function initTheme() {
  applyTheme();
  systemDark().addEventListener("change", applyTheme);
}

function subscribe(notify: () => void) {
  listeners.add(notify);
  return () => listeners.delete(notify);
}

/** 用户选的外观（含「跟随系统」）。 */
export function useThemeMode(): ThemeMode {
  return useSyncExternalStore(subscribe, getThemeMode);
}

/** 实际显示的外观。自己画颜色的组件（甘特图、图表）用它在切换时重画。 */
export function useResolvedTheme(): "light" | "dark" {
  return useSyncExternalStore(subscribe, resolvedTheme);
}
