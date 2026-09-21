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
  const desktopPlatform = window.desktopBridge?.getClientPlatform?.();
  const isDarwinOrWin = desktopPlatform === "darwin" || desktopPlatform === "win32";
  const isMac = typeof navigator !== "undefined" && (/Mac|iPhone|iPad/i.test(navigator.platform) || /Mac/i.test(navigator.userAgent));
  const isWin = typeof navigator !== "undefined" && (/Win/i.test(navigator.platform) || /Windows/i.test(navigator.userAgent));
  return (isDarwinOrWin || Boolean(isTauri || (window as any).isTauri || (window as any).__TAURI_INTERNALS__)) && (isMac || isWin || isDarwinOrWin);
}

export async function syncNativeWindowGlass(enabled: boolean, blurRadius: number) {
  try {
    const { invoke } = await import("@tauri-apps/api/core");
    await invoke("set_window_glass_enabled", { enabled });
    if (enabled) {
      await invoke("set_window_background_blur", { radius: blurRadius });
    }
  } catch {
    // Non-Tauri environment
  }
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
    root.style.backgroundColor = "transparent";
    if (typeof document !== "undefined" && document.body) {
      document.body.style.backgroundColor = "transparent";
    }
    void window.desktopBridge?.setWindowGlassEnabled?.(true);
    void window.desktopBridge?.setWindowBackgroundBlur?.(options.sidebarBlur);
    void syncNativeWindowGlass(true, options.sidebarBlur);
  } else {
    void window.desktopBridge?.setWindowGlassEnabled?.(false);
    void syncNativeWindowGlass(false, options.sidebarBlur);
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
