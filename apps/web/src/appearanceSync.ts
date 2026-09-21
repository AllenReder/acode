import { convertFileSrc } from "@tauri-apps/api/core";
import { isTauri } from "./env";

export interface WindowGlassSettings {
  readonly sidebarOpacity: number;
  readonly sidebarBlur: number;
  readonly workbenchGlass: boolean;
  readonly workbenchOpacity: number;
}

export interface ChatBackgroundSettings {
  readonly path: string | null;
  readonly opacity: number;
  readonly scope: "empty" | "all";
}

export function isNativeGlassPlatform(): boolean {
  if (typeof window === "undefined") return false;
  if (!isTauri) return false;
  const platform = window.desktopBridge?.getClientPlatform?.() ?? "";
  return platform === "darwin" || platform === "win32" || navigator.userAgent.includes("Mac") || navigator.userAgent.includes("Windows");
}

export function applyWindowGlass(
  options: WindowGlassSettings,
  root: HTMLElement | null = typeof document !== "undefined" ? document.documentElement : null,
) {
  if (!root) return;
  const isDesktopGlass = isNativeGlassPlatform();
  root.classList.toggle("has-native-glass", isDesktopGlass);

  root.style.setProperty("--sidebar-opacity", `${options.sidebarOpacity / 100}`);
  root.style.setProperty("--sidebar-blur", `${options.sidebarBlur}px`);
  root.style.setProperty("--workbench-opacity", `${options.workbenchOpacity / 100}`);
  root.classList.toggle("glass-workbench", isDesktopGlass && options.workbenchGlass);

  if (isDesktopGlass) {
    void window.desktopBridge?.setWindowGlassEnabled?.(true);
    void window.desktopBridge?.setWindowBackgroundBlur?.(options.sidebarBlur);
  } else {
    void window.desktopBridge?.setWindowGlassEnabled?.(false);
  }
}

export function applyChatBackground(
  options: ChatBackgroundSettings,
  root: HTMLElement | null = typeof document !== "undefined" ? document.documentElement : null,
) {
  if (!root) return;
  const hasBackground = Boolean(options.path && options.path.trim().length > 0);
  root.classList.toggle("has-chat-background", hasBackground);
  root.classList.toggle("chat-background-empty-only", options.scope === "empty");

  if (!hasBackground || !options.path) {
    root.style.removeProperty("--chat-background-image");
    root.style.removeProperty("--chat-background-opacity");
    return;
  }

  const src = isTauri && typeof window !== "undefined" ? convertFileSrc(options.path) : options.path;
  root.style.setProperty("--chat-background-image", `url(${JSON.stringify(src)})`);
  root.style.setProperty("--chat-background-opacity", `${options.opacity / 100}`);
}
