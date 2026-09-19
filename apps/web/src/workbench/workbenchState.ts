import type {
  AgentSessionId,
  EnvironmentId,
  WorkspaceId,
} from "@t3tools/contracts";

import {
  closeLeaf,
  newTab,
  setSplitRatio,
  splitPane,
  type AcodeTab,
  type SplitDir,
} from "./layout.ts";
import { targetKey, type ViewTarget } from "./viewRegistry.ts";

/**
 * The workbench's externally observable state. A single Tab in C10; C11 will
 * introduce multi-tab and add `tabs: AcodeTab[]` plus an active index.
 *
 * `panes` is the View-instance map keyed by leaf id. A leaf id that has no
 * entry in `panes` is an "empty pane" (no View target bound yet) — useful
 * for the initial empty Tab and for the post-close-reset state.
 */
export interface WorkbenchSnapshot {
  readonly tab: AcodeTab;
  readonly panes: ReadonlyMap<string, ViewTarget>;
}

export function emptyWorkbenchSnapshot(generateId: () => string): WorkbenchSnapshot {
  const initialPaneId = generateId();
  return {
    tab: newTab(initialPaneId),
    panes: new Map(),
  };
}

/**
 * Focus an existing pane already showing `target`; otherwise replace the
 * focused pane's target. If the workbench has no panes (empty tab), bind the
 * target to the single empty leaf.
 *
 * This implements the C10 click semantics: opening an already-open Session
 * surfaces its existing Pane instead of creating a duplicate; opening a new
 * Session reuses the focused Pane.
 */
export function applyOpenTarget(
  snapshot: WorkbenchSnapshot,
  target: ViewTarget,
  generateId: () => string,
): WorkbenchSnapshot {
  const existingPaneId = findPaneByTarget(snapshot, target);
  if (existingPaneId !== null) {
    return {
      tab: { ...snapshot.tab, focusedPaneId: existingPaneId },
      panes: snapshot.panes,
    };
  }

  const focusedPaneId = snapshot.tab.focusedPaneId;
  const panes = new Map(snapshot.panes);
  panes.set(focusedPaneId, target);
  return { tab: snapshot.tab, panes };
}

/**
 * Split the focused pane in `dir` and bind `target` to the new pane. Focus
 * moves to the new pane. If the focused pane is empty (no View target yet),
 * the new pane is opened beside it with the new target and focus stays on
 * the new pane.
 */
export function applySplitFocused(
  snapshot: WorkbenchSnapshot,
  target: ViewTarget,
  dir: SplitDir,
  generateId: () => string,
): WorkbenchSnapshot {
  const focusedPaneId = snapshot.tab.focusedPaneId;
  const newPaneId = generateId();
  const layout = splitPane(snapshot.tab.layout, focusedPaneId, dir, newPaneId);
  const panes = new Map(snapshot.panes);
  panes.set(newPaneId, target);
  return {
    tab: { ...snapshot.tab, layout, focusedPaneId: newPaneId },
    panes,
  };
}

/**
 * Close one pane. The leaf is removed from the layout (parent splits
 * collapse); the View instance map entry is dropped; the underlying
 * Agent/Terminal Session is **not** affected (D3: "Closing a View/Pane/Tab
 * does not by itself terminate a Session").
 *
 * Returns null when there is nothing to close (the pane id is unknown or the
 * pane has already been removed).
 *
 * When the last leaf closes, the workbench resets to a fresh empty Tab —
 * the user can immediately open another target. The empty pane carries no
 * View target and no Session.
 */
export function applyClosePane(
  snapshot: WorkbenchSnapshot,
  paneId: string,
  generateId: () => string,
): WorkbenchSnapshot | null {
  if (!isLeafReachable(snapshot.tab.layout, paneId)) {
    return null;
  }
  const next = closeLeaf(snapshot.tab, paneId);
  if (next === null) {
    return emptyWorkbenchSnapshot(generateId);
  }
  const panes = new Map(snapshot.panes);
  panes.delete(paneId);
  return { tab: next, panes };
}

export function applySetFocused(
  snapshot: WorkbenchSnapshot,
  paneId: string,
): WorkbenchSnapshot {
  if (!isLeafReachable(snapshot.tab.layout, paneId)) {
    return snapshot;
  }
  if (snapshot.tab.focusedPaneId === paneId) return snapshot;
  return { tab: { ...snapshot.tab, focusedPaneId: paneId }, panes: snapshot.panes };
}

export function applySetSplitRatio(
  snapshot: WorkbenchSnapshot,
  splitId: string,
  index: number,
  ratio: number,
): WorkbenchSnapshot {
  const layout = setSplitRatio(snapshot.tab.layout, splitId, index, ratio);
  if (layout === snapshot.tab.layout) return snapshot;
  return { tab: { ...snapshot.tab, layout }, panes: snapshot.panes };
}

function findPaneByTarget(
  snapshot: WorkbenchSnapshot,
  target: ViewTarget,
): string | null {
  const key = targetKey(target);
  for (const [paneId, paneTarget] of snapshot.panes) {
    if (targetKey(paneTarget) === key) return paneId;
  }
  return null;
}

function isLeafReachable(
  layout: AcodeTab["layout"],
  paneId: string,
): boolean {
  if (layout.type === "leaf") return layout.id === paneId;
  return layout.children.some((child) => isLeafReachable(child, paneId));
}

/**
 * Look up the View target bound to a leaf, or null if the leaf is empty.
 * Used by the PaneTree renderer.
 */
export function getPaneTarget(
  snapshot: WorkbenchSnapshot,
  paneId: string,
): ViewTarget | null {
  return snapshot.panes.get(paneId) ?? null;
}

/**
 * A stable string key for a pane's View target, used by tests and the View
 * layer to avoid double-subscribing to the same Agent Session. Returns null
 * for empty panes.
 */
export function paneTargetKey(
  snapshot: WorkbenchSnapshot,
  paneId: string,
): string | null {
  const target = snapshot.panes.get(paneId);
  return target === undefined ? null : targetKey(target);
}

/** Surface types re-exported so callers don't need a second import. */
export type { AcodeTab, SplitDir };
export type WorkbenchEnvironmentId = EnvironmentId;
export type WorkbenchWorkspaceId = WorkspaceId;
export type WorkbenchAgentSessionId = AgentSessionId;