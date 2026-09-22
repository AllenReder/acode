/**
 * Operations for controlling desktop application window state (minimize, maximize, close).
 * Uses dynamic import so loading this module outside Tauri or in unit tests does not throw.
 */

import { isDesktop } from "../env";
import { isWindowsPlatform } from "./utils";

export function isDesktopEnvironment(): boolean {
  if (typeof window === "undefined") return false;
  return (
    isDesktop ||
    "__TAURI_INTERNALS__" in window ||
    "isTauri" in window ||
    Boolean((window as any).isTauri)
  );
}

export interface WindowBridgeOperations {
  readonly minimize: () => Promise<void>;
  readonly toggleMaximize: () => Promise<void>;
  readonly close: () => Promise<void>;
  readonly isMaximized: () => Promise<boolean>;
  readonly isFullscreen: () => Promise<boolean>;
  readonly onResized?: (listener: () => void) => () => void;
}

async function getTauriWindow() {
  if (typeof window === "undefined" || !("__TAURI_INTERNALS__" in window)) {
    return null;
  }
  try {
    const { getCurrentWindow } = await import("@tauri-apps/api/window");
    return getCurrentWindow();
  } catch {
    return null;
  }
}

async function withWindow(run: (win: NonNullable<Awaited<ReturnType<typeof getTauriWindow>>>) => Promise<void>) {
  try {
    const win = await getTauriWindow();
    if (win) {
      await run(win);
    }
  } catch (error) {
    console.error("Window operation failed", error);
  }
}

export const defaultWindowOperations: WindowBridgeOperations = {
  minimize: () => withWindow((win) => win.minimize()),
  toggleMaximize: () => withWindow((win) => win.toggleMaximize()),
  close: () => withWindow((win) => win.close()),
  isMaximized: async () => {
    try {
      const win = await getTauriWindow();
      return win ? await win.isMaximized() : false;
    } catch {
      return false;
    }
  },
  isFullscreen: async () => {
    try {
      const win = await getTauriWindow();
      return win ? await win.isFullscreen() : false;
    } catch {
      return false;
    }
  },
  onResized: (listener: () => void) => {
    let unlisten: (() => void) | null = null;
    let active = true;

    void getTauriWindow().then((win) => {
      if (!win || !active) return;
      void win.listen("tauri://resize", listener).then((unlistenFn) => {
        if (!active) {
          unlistenFn();
        } else {
          unlisten = unlistenFn;
        }
      });
    });

    return () => {
      active = false;
      unlisten?.();
    };
  },
};

export function handleTopbarDoubleClick(event: React.MouseEvent): void {
  if (typeof navigator === "undefined" || !isWindowsPlatform(navigator.platform) || !isDesktopEnvironment()) {
    return;
  }
  const target = event.target as HTMLElement | null;
  if (target?.closest?.("button, a, input, select, textarea, [data-no-drag], [role='tab'], [data-tab-id]")) {
    return;
  }
  void defaultWindowOperations.toggleMaximize();
}
