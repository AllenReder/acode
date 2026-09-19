import type { EnvironmentId, WorkspaceId } from "@t3tools/contracts";
import { runtimeTerminalIdForSession, terminalSessionRefForRuntime } from "@t3tools/contracts";

import type { ViewTarget } from "./viewRegistry";

/**
 * The Workbench's Terminal Session target.
 *
 * The product-level identity is the ACode `terminalSessionId`, scoped to its
 * owning Workspace. The runtime PTY id is not part of the target: existing
 * terminal flows still speak `(workspaceId, terminalId)`, and this module is
 * the one boundary that translates between the two.
 */
export type WorkspaceTerminalTarget = Extract<ViewTarget, { kind: "workspaceTerminal" }>;

/**
 * Adapter from the terminal runtime identity to a Workbench target.
 *
 * Every existing creation path (the Sidebar's "New terminal", any known
 * Terminal Session summary) already has `(workspaceId, terminalId)`; the
 * reference adapter turns that into the canonical ACode Terminal Session
 * identity so the Workbench never dedupes on a raw PTY id.
 */
export function terminalTargetForRuntime(input: {
  readonly environmentId: EnvironmentId;
  readonly workspaceId: WorkspaceId;
  readonly terminalId: string;
}): WorkspaceTerminalTarget {
  const ref = terminalSessionRefForRuntime({
    workspaceId: input.workspaceId,
    terminalId: input.terminalId,
  });
  return {
    kind: "workspaceTerminal",
    environmentId: input.environmentId,
    workspaceId: ref.workspaceId,
    terminalSessionId: ref.terminalSessionId,
  };
}

/**
 * Adapter from a Workbench target back to the terminal runtime identity that
 * attaches, writes, and resizes through the existing terminal RPC.
 *
 * Returns null when the target's identity did not come from the ACode
 * Terminal Session adapter, so callers surface "no runtime binding" instead
 * of attaching to an arbitrary terminal.
 */
export function runtimeTerminalIdForTarget(target: WorkspaceTerminalTarget): string | null {
  return runtimeTerminalIdForSession({
    kind: "terminal",
    workspaceId: target.workspaceId,
    terminalSessionId: target.terminalSessionId,
  });
}
