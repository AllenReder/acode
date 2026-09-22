import { convertFileSrc } from "@tauri-apps/api/core";
import { isTauri } from "./env";

export interface ChatBackgroundSettings {
  readonly path: string | null;
  readonly opacity: number;
}

export interface MaterialSettings {
  readonly stageEnabled: boolean;
  readonly stageStrength: number;
  readonly surfaceOpacity: number;
}

export function isNativeGlassPlatform(): boolean {
  if (typeof window === "undefined") return false;
  const desktopPlatform = window.desktopBridge?.getClientPlatform?.();
  const isDarwinOrWin = desktopPlatform === "darwin" || desktopPlatform === "win32";
  const isMac =
    typeof navigator !== "undefined" &&
    (/Mac|iPhone|iPad/i.test(navigator.platform) || /Mac/i.test(navigator.userAgent));
  const isWin =
    typeof navigator !== "undefined" &&
    (/Win/i.test(navigator.platform) || /Windows/i.test(navigator.userAgent));
  return (
    (isDarwinOrWin ||
      Boolean(isTauri || (window as any).isTauri || (window as any).__TAURI_INTERNALS__)) &&
    (isMac || isWin || isDarwinOrWin)
  );
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

export function applyMaterialSettings(
  options: MaterialSettings,
  root: HTMLElement | null = typeof document !== "undefined" ? document.documentElement : null,
) {
  if (!root) return;
  const nativeStage = options.stageEnabled && isNativeGlassPlatform();
  root.classList.toggle("material-stage-native", nativeStage);
  root.classList.toggle("material-stage-opaque", !nativeStage);

  const surfaceOpacity = nativeStage ? options.surfaceOpacity / 100 : 1;
  root.style.setProperty("--material-stage-strength", `${options.stageStrength}`);
  root.style.setProperty("--material-surface-opacity", `${surfaceOpacity}`);
  for (const surface of ["sidebar", "topbar", "workbench", "overlay"] as const) {
    root.style.setProperty(`--material-${surface}-opacity`, `${surfaceOpacity}`);
  }

  const blurRadius = Math.max(1, Math.round((options.stageStrength / 100) * 52));
  if (nativeStage) {
    root.style.backgroundColor = "transparent";
    if (typeof document !== "undefined" && document.body) {
      document.body.style.backgroundColor = "transparent";
    }
    void window.desktopBridge?.setWindowGlassEnabled?.(true);
    void window.desktopBridge?.setWindowBackgroundBlur?.(blurRadius);
    void syncNativeWindowGlass(true, blurRadius);
  } else {
    root.style.backgroundColor = "";
    if (typeof document !== "undefined" && document.body) {
      document.body.style.backgroundColor = "";
    }
    void window.desktopBridge?.setWindowGlassEnabled?.(false);
    void syncNativeWindowGlass(false, blurRadius);
  }
}

export function applyWorkbenchArtwork(
  options: ChatBackgroundSettings,
  root: HTMLElement | null = typeof document !== "undefined" ? document.documentElement : null,
) {
  if (!root) return;
  const hasBackground = Boolean(options.path && options.path.trim().length > 0);
  if (!hasBackground || !options.path) {
    root.style.removeProperty("--workbench-artwork-image");
    root.style.removeProperty("--workbench-artwork-opacity");
    return;
  }

  const src =
    isTauri && typeof window !== "undefined" ? convertFileSrc(options.path) : options.path;
  root.style.setProperty("--workbench-artwork-image", `url(${JSON.stringify(src)})`);
  root.style.setProperty("--workbench-artwork-opacity", `${options.opacity / 100}`);
}
