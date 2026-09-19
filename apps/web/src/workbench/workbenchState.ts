import {
  closeLeaf,
  firstLeafId,
  leafIds,
  newTab,
  setSplitRatio,
  splitPane,
  type AcodeTab,
  type SplitDir,
} from "./layout.ts";
import { definitionIdForTarget, targetKey, type ViewTarget } from "./viewRegistry.ts";

/** One presentation occurrence, independent of the Session it displays. */
export interface ViewInstance {
  readonly id: string;
  readonly definitionId: string;
  readonly target: ViewTarget;
}

/** Every layout leaf owns exactly one ViewInstance. */
export interface WorkbenchTab extends AcodeTab {
  readonly panes: ReadonlyMap<string, ViewInstance>;
}

export interface WorkbenchSnapshot {
  readonly tabs: ReadonlyArray<WorkbenchTab>;
  readonly activeTabId: string;
}

export function getActiveTab(snapshot: WorkbenchSnapshot): WorkbenchTab {
  const tab = snapshot.tabs.find((tab) => tab.id === snapshot.activeTabId);
  if (!tab) throw new Error("Workbench active Tab is missing");
  return tab;
}

function viewInstance(target: ViewTarget, generateId: () => string): ViewInstance {
  return { id: generateId(), definitionId: definitionIdForTarget(target), target };
}

function welcomeTab(generateId: () => string): WorkbenchTab {
  const paneId = generateId();
  return {
    ...newTab(paneId),
    panes: new Map([[paneId, viewInstance({ kind: "welcome" }, generateId)]]),
  };
}

export function emptyWorkbenchSnapshot(generateId: () => string): WorkbenchSnapshot {
  const tab = welcomeTab(generateId);
  return { tabs: [tab], activeTabId: tab.id };
}

function updateTab(snapshot: WorkbenchSnapshot, tab: WorkbenchTab): WorkbenchSnapshot {
  return {
    ...snapshot,
    tabs: snapshot.tabs.map((current) => (current.id === tab.id ? tab : current)),
  };
}

/** Focus an existing Session View; otherwise replace the focused View. */
export function applyOpenTarget(
  snapshot: WorkbenchSnapshot,
  target: ViewTarget,
  generateId: () => string,
): WorkbenchSnapshot {
  const tab = getActiveTab(snapshot);
  const existingPaneId = findPaneByTarget(tab, target);
  if (existingPaneId !== null) return applySetFocused(snapshot, existingPaneId);
  const panes = new Map(tab.panes);
  panes.set(tab.focusedPaneId, viewInstance(target, generateId));
  return updateTab(snapshot, { ...tab, panes });
}

export function applySplitFocused(
  snapshot: WorkbenchSnapshot,
  target: ViewTarget,
  dir: SplitDir,
  generateId: () => string,
): WorkbenchSnapshot {
  const tab = getActiveTab(snapshot);
  if (tab.panes.get(tab.focusedPaneId)?.target.kind === "welcome")
    return applyOpenTarget(snapshot, target, generateId);
  const existing = findPaneByTarget(tab, target);
  if (existing !== null) return applySetFocused(snapshot, existing);
  const paneId = generateId();
  const panes = new Map(tab.panes);
  panes.set(paneId, viewInstance(target, generateId));
  return updateTab(snapshot, {
    ...tab,
    panes,
    layout: splitPane(tab.layout, tab.focusedPaneId, dir, paneId),
    focusedPaneId: paneId,
  });
}

/** Closing presentation never stops or deletes its Session. */
export function applyClosePane(
  snapshot: WorkbenchSnapshot,
  paneId: string,
  generateId: () => string,
): WorkbenchSnapshot | null {
  const tab = getActiveTab(snapshot);
  if (!tab.panes.has(paneId)) return null;
  const next = closeLeaf(tab, paneId);
  if (next === null) return updateTab(snapshot, { ...welcomeTab(generateId), id: tab.id });
  const panes = new Map(tab.panes);
  panes.delete(paneId);
  return updateTab(snapshot, { ...next, panes });
}

export function applySetFocused(snapshot: WorkbenchSnapshot, paneId: string): WorkbenchSnapshot {
  const tab = getActiveTab(snapshot);
  if (!tab.panes.has(paneId) || tab.focusedPaneId === paneId) return snapshot;
  return updateTab(snapshot, { ...tab, focusedPaneId: paneId });
}

export function applySetSplitRatio(
  snapshot: WorkbenchSnapshot,
  splitId: string,
  index: number,
  ratio: number,
): WorkbenchSnapshot {
  const tab = getActiveTab(snapshot);
  if (!Number.isFinite(ratio)) return snapshot;
  const layout = setSplitRatio(tab.layout, splitId, index, ratio);
  return layout === tab.layout ? snapshot : updateTab(snapshot, { ...tab, layout });
}

/** Find a pane in a Tab that displays the given Session target. */
export function findPaneBySessionTarget(tab: WorkbenchTab, target: ViewTarget): string | null {
  for (const [paneId, view] of tab.panes) {
    if (isSameSessionTarget(view.target, target)) return paneId;
  }
  return null;
}

function findPaneByTarget(tab: WorkbenchTab, target: ViewTarget): string | null {
  const key = targetKey(target);
  for (const [paneId, view] of tab.panes) {
    if (targetKey(view.target) === key) return paneId;
  }
  return null;
}

export function getPaneTarget(snapshot: WorkbenchSnapshot, paneId: string): ViewTarget | null {
  return getActiveTab(snapshot).panes.get(paneId)?.target ?? null;
}

export function paneTargetKey(snapshot: WorkbenchSnapshot, paneId: string): string | null {
  const target = getPaneTarget(snapshot, paneId);
  return target === null ? null : targetKey(target);
}

export type { AcodeTab, SplitDir };

/** Create a presentation area; Tabs have no Workspace owner. */
export function applyCreateTab(
  snapshot: WorkbenchSnapshot,
  generateId: () => string,
): WorkbenchSnapshot {
  const tab = welcomeTab(generateId);
  return { tabs: [...snapshot.tabs, tab], activeTabId: tab.id };
}

export function applyActivateTab(snapshot: WorkbenchSnapshot, tabId: string): WorkbenchSnapshot {
  return snapshot.tabs.some((tab) => tab.id === tabId) && snapshot.activeTabId !== tabId
    ? { ...snapshot, activeTabId: tabId }
    : snapshot;
}

/** Compare two targets by Session identity across environments and workspaces. */
export function isSameSessionTarget(a: ViewTarget, b: ViewTarget): boolean {
  if (a.kind === "agentSession" && b.kind === "agentSession") {
    return (
      a.environmentId === b.environmentId &&
      a.workspaceId === b.workspaceId &&
      a.agentSessionId === b.agentSessionId
    );
  }
  if (a.kind === "workspaceTerminal" && b.kind === "workspaceTerminal") {
    return (
      a.environmentId === b.environmentId &&
      a.workspaceId === b.workspaceId &&
      a.terminalSessionId === b.terminalSessionId
    );
  }
  return false;
}

/**
 * Remove every ViewInstance displaying this Session from every Tab.
 *
 * Preserves Tab IDs, activeTabId, and other ViewInstance identities.
 * Cleared Tabs recover Welcome.
 */
export function applyRemoveSessionViews(
  snapshot: WorkbenchSnapshot,
  target: ViewTarget,
  generateId: () => string,
): WorkbenchSnapshot {
  let changed = false;
  const tabs = snapshot.tabs.map((tab) => {
    const matchingPaneIds: string[] = [];
    for (const [paneId, view] of tab.panes) {
      if (isSameSessionTarget(view.target, target)) {
        matchingPaneIds.push(paneId);
      }
    }
    if (matchingPaneIds.length === 0) return tab;
    changed = true;
    let currentTab: AcodeTab | null = { ...tab };
    const panes = new Map(tab.panes);
    for (const paneId of matchingPaneIds) {
      panes.delete(paneId);
      if (currentTab !== null) {
        currentTab = closeLeaf(currentTab, paneId);
      }
    }
    if (currentTab === null) {
      return { ...welcomeTab(generateId), id: tab.id };
    }
    const validFocus = leafIds(currentTab.layout).includes(currentTab.focusedPaneId)
      ? currentTab.focusedPaneId
      : firstLeafId(currentTab.layout);
    return {
      ...tab,
      layout: currentTab.layout,
      focusedPaneId: validFocus,
      panes,
    };
  });

  return changed ? { ...snapshot, tabs } : snapshot;
}
