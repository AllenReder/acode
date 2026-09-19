import { useEffect, useRef, useState } from "react";

import { TerminalViewport } from "../components/ThreadTerminalDrawer";
import { useAcodeWorkspace } from "../state/entities";
import { runtimeTerminalIdForTarget } from "./sessionTarget";
import { useWorkbenchStore } from "./workbenchStore";
import type { ViewTarget } from "./viewRegistry";

interface TerminalViewProps {
  readonly target: Extract<ViewTarget, { kind: "workspaceTerminal" }>;
  readonly paneId: string;
  readonly focused: boolean;
  readonly availableSize: { readonly width: number; readonly height: number };
}

/**
 * View definition rendering one ACode Workspace-owned Terminal Session inside
 * a Pane.
 *
 * Reuses the existing `<TerminalViewport>` (the Ghostty-backed emulator that
 * already handles ANSI, alternate-screen, resize, and selection). The View
 * passes the Workspace's cwd and the pane's focus flag through without
 * re-implementing the emulator.
 *
 * The pane carries the ACode Terminal Session identity; the runtime PTY id the
 * emulator attaches to is resolved at this adapter boundary, so no other
 * Workbench code has to know it.
 *
 * Closing this View (closing the Pane) leaves the PTY running on the daemon —
 * the user can reopen the same Session from the Sidebar and reconnect to its
 * scrollback. Stop / terminate is a separate, explicit user action; see D3.
 */
export function TerminalView({ target, paneId, focused }: TerminalViewProps) {
  void paneId;
  const workspace = useAcodeWorkspace(target.environmentId, target.workspaceId);
  const terminalId = runtimeTerminalIdForTarget(target);
  // Bump focusRequestId every time `focused` flips true so the viewport's
  // focus effect re-runs even on the same focused Pane after a Sidebar click.
  const [focusRequestId, setFocusRequestId] = useState(0);
  const lastFocusedRef = useRef(focused);
  useEffect(() => {
    if (focused && !lastFocusedRef.current) {
      setFocusRequestId((id) => id + 1);
    }
    lastFocusedRef.current = focused;
  }, [focused]);

  // Touch the store so the renderer subscribes to focus changes if the
  // terminal view is rendered as a placeholder in tests.
  useWorkbenchStore((state) => state.tab.focusedPaneId);

  if (workspace === null || terminalId === null) {
    return (
      <div className="flex h-full min-h-0 items-center justify-center p-6 text-sm text-muted-foreground">
        Terminal Session is no longer available.
      </div>
    );
  }

  return (
    <TerminalViewport
      advancedTypography={false}
      environmentId={target.environmentId}
      workspaceId={target.workspaceId}
      terminalId={terminalId}
      terminalLabel="Terminal"
      cwd={workspace.workspaceRoot}
      onSessionExited={() => undefined}
      focusRequestId={focusRequestId}
      autoFocus={focused}
      visible
      resizeEpoch={0}
      drawerHeight={0}
      keybindings={[]}
    />
  );
}