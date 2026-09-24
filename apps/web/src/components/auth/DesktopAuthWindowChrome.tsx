import type { ReactNode } from "react";

import { MaterialSurface } from "../MaterialSurface";
import { WindowControls } from "../desktop/WindowControls";
import {
  handleTopbarDoubleClick,
  isDesktopEnvironment,
  type WindowBridgeOperations,
} from "../../lib/windowControls";
import { usesCustomWindowChrome } from "../../lib/utils";

export interface DesktopAuthWindowChromeProps {
  readonly children: ReactNode;
  readonly operations?: WindowBridgeOperations;
}

/**
 * Gives auth and pre-shell states the same frameless titlebar geometry as the
 * Workbench on Windows and Linux. Browser and macOS surfaces stay unchanged.
 */
export function DesktopAuthWindowChrome({ children, operations }: DesktopAuthWindowChromeProps) {
  const usesDesktopChrome =
    typeof navigator !== "undefined" &&
    isDesktopEnvironment() &&
    usesCustomWindowChrome(navigator.platform);

  if (!usesDesktopChrome) {
    return <>{children}</>;
  }

  return (
    <>
      <MaterialSurface
        kind="topbar"
        className="drag-region fixed inset-x-0 top-0 z-50 flex h-[var(--workbench-titlebar-height,36px)] items-center border-b border-[var(--material-edge)]"
        data-slot="desktop-auth-window-chrome"
        data-tauri-drag-region="deep"
        onDoubleClick={(event) => handleTopbarDoubleClick(event, operations)}
      >
        <div
          aria-hidden
          className="h-full min-w-0 flex-1"
          data-slot="desktop-auth-window-chrome-drag-region"
          data-tauri-drag-region
        />
        {operations ? <WindowControls operations={operations} /> : <WindowControls />}
      </MaterialSurface>
      {children}
    </>
  );
}
