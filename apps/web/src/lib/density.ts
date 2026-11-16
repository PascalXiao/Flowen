import { useSyncExternalStore } from "react";

/** 列表密度：紧凑（行更矮、边距更小）或标准。记在浏览器里，默认标准。 */
export type Density = "compact" | "standard";

const KEY = "flowen-density";
const listeners = new Set<() => void>();

function read(): Density {
  try {
    return localStorage.getItem(KEY) === "compact" ? "compact" : "standard";
  } catch {
    return "standard";
  }
}

export function setDensity(density: Density) {
  try {
    if (density === "standard") localStorage.removeItem(KEY);
    else localStorage.setItem(KEY, density);
  } catch {
    // 存不了就只在这次打开里生效
  }
  for (const notify of listeners) notify();
}

export function useDensity(): Density {
  return useSyncExternalStore(
    (notify) => {
      listeners.add(notify);
      return () => listeners.delete(notify);
    },
    read,
    () => "standard",
  );
}
