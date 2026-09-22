import {
  columnsTree,
  reconcileColumns,
  reconcileBsp,
  placeInColumns,
  adjacentScrollingPaneTarget,
  LAYOUT_VERSION,
  MIN_COLUMN_WIDTH,
  MAX_COLUMN_WIDTH,
  type Column,
  type LayoutMode,
  type LayoutMemory,
} from "./scrollingLayout";
import {
  closeLeaf,
  firstLeafId,
  leafParent,
  neighborLeafId,
  leafIds,
  movePane,
  newTab,
  placePane,
  removePane,
  replaceLeafId,
  setSplitRatio,
  type AcodeTab,
  type FocusDir,
  type PaneEdge,
  type PaneDropZone,
  type SplitDir,
} from "./layout.ts";
import { definitionIdForTarget, targetKey, type ViewTarget } from "./viewRegistry.ts";
import { fallbackTargetTitle } from "./workbenchTitles.ts";

/** One presentation occurrence, independent of the Session it displays. */
export interface ViewInstance {
  readonly id: string;
  readonly definitionId: string;
  readonly target: ViewTarget;
}

/** Every layout leaf owns exactly one ViewInstance. */
export interface WorkbenchTab extends AcodeTab {
  readonly panes: ReadonlyMap<string, ViewInstance>;
  readonly layoutMode?: LayoutMode;
  readonly columns?: readonly Column[];
  readonly layoutMemory?: LayoutMemory;
  readonly titleMode: "auto" | "manual";
  readonly titleOverride: string | null;
}

export interface WorkbenchSnapshot {
  readonly tabs: ReadonlyArray<WorkbenchTab>;
  readonly activeTabId: string;
}

export type SessionViewTarget = Extract<ViewTarget, { kind: "agentSession" | "workspaceTerminal" }>;

export type ViewDragSource =
  | { readonly kind: "sidebar"; readonly target: SessionViewTarget }
  | { readonly kind: "pane"; readonly tabId: string; readonly paneId: string };

export type ViewDuplicateSource = {
  readonly kind: "pane";
  readonly tabId: string;
  readonly paneId: string;
};

export type ViewDropTarget =
  | {
      readonly kind: "pane";
      readonly tabId: string;
      readonly paneId: string;
      readonly zone: PaneDropZone;
    }
  | { readonly kind: "existingTab"; readonly tabId: string }
  | { readonly kind: "newTab"; readonly index: number };

export interface ViewDropResult {
  readonly snapshot: WorkbenchSnapshot;
  readonly tabId: string;
  readonly paneId: string;
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
    titleMode: "auto",
    titleOverride: null,
  };
}

export function emptyWorkbenchSnapshot(generateId: () => string): WorkbenchSnapshot {
  const tab = welcomeTab(generateId);
  return { tabs: [tab], activeTabId: tab.id };
}

export function tabDisplayTitle(
  tab: WorkbenchTab,
  resolveTargetTitle: (target: ViewTarget) => string,
): string {
  if (tab.titleMode === "manual" && tab.titleOverride !== null) return tab.titleOverride;
  const firstPane = tab.panes.get(firstLeafId(tab.layout));
  if (firstPane === undefined) return "Welcome";
  const resolved = resolveTargetTitle(firstPane.target).trim();
  return resolved.length > 0 ? resolved : fallbackTargetTitle(firstPane.target);
}

function updateTab(snapshot: WorkbenchSnapshot, tab: WorkbenchTab): WorkbenchSnapshot {
  tab = reconcileTab(tab);
  return {
    ...snapshot,
    tabs: snapshot.tabs.map((current) => (current.id === tab.id ? tab : current)),
  };
}

export function reconcileTab(tab: WorkbenchTab): WorkbenchTab {
  if (tab.layoutMode !== "scrolling") return tab;
  const ids = leafIds(tab.layout).filter((id) => tab.panes.has(id));
  for (const id of tab.panes.keys()) if (!ids.includes(id)) ids.push(id);
  const columns = reconcileColumns(tab.columns ?? [], ids);
  return { ...tab, columns, layout: columnsTree(columns) };
}

/** Determine the initial drop target and zone for an existing pane in its current tab. */
export function initialPaneDropTarget(tab: WorkbenchTab, paneId: string): ViewDropTarget | null {
  if (tab.panes.size <= 1) return null;
  if (tab.layoutMode === "scrolling") {
    return adjacentScrollingPaneTarget(tab.columns ?? [], tab.id, paneId);
  }

  const parent = leafParent(tab.layout, paneId);
  if (!parent) return null;
  const neighborDir: FocusDir =
    parent.dir === "right"
      ? parent.index > 0
        ? "left"
        : "right"
      : parent.index > 0
        ? "up"
        : "down";
  const neighbor = neighborLeafId(tab.layout, paneId, neighborDir);
  if (!neighbor) return null;
  const zone: PaneDropZone =
    parent.dir === "right"
      ? parent.index === 0
        ? "left"
        : "right"
      : parent.index === 0
        ? "top"
        : "bottom";
  return { kind: "pane", tabId: tab.id, paneId: neighbor, zone };
}

/** Compute the base tab layout when dragging a pane, treating the tab as if the pane is removed. */
export function computeBaseTab(tab: WorkbenchTab, draggedPaneId: string): WorkbenchTab | null {
  if (tab.panes.size <= 1) return null;
  if (!tab.panes.has(draggedPaneId)) return tab;

  const panes = new Map(tab.panes);
  panes.delete(draggedPaneId);

  if (tab.layoutMode === "scrolling") {
    const remainingIds = [...panes.keys()];
    const columns = reconcileColumns(tab.columns ?? [], remainingIds);
    const layout = columnsTree(columns);
    return { ...tab, layout, columns, panes };
  }

  const layout = removePane(tab.layout, draggedPaneId);
  if (layout === null) return null;
  return { ...tab, layout, panes };
}

function placedLayout(tab: WorkbenchTab, paneId: string, targetId: string, zone: PaneDropZone) {
  if (tab.layoutMode !== "scrolling")
    return {
      layout:
        zone === "replace"
          ? replaceLeafId(tab.layout, targetId, paneId)
          : placePane(tab.layout, paneId, targetId, zone),
    };
  const columns = placeInColumns(tab.columns ?? [], paneId, targetId, zone);
  return { columns, layout: columnsTree(columns) };
}

export function applySetLayoutMode(
  snapshot: WorkbenchSnapshot,
  mode: LayoutMode,
): WorkbenchSnapshot {
  const tab = getActiveTab(snapshot);
  if ((tab.layoutMode ?? "bsp") === mode) return snapshot;
  const memory =
    tab.layoutMemory?.version === LAYOUT_VERSION ? tab.layoutMemory : { version: LAYOUT_VERSION };
  const ids = leafIds(tab.layout);
  if (mode === "scrolling") {
    const columns = reconcileColumns(memory.columns ?? [], ids);
    return updateTab(snapshot, {
      ...tab,
      layoutMode: mode,
      columns,
      layout: columnsTree(columns),
      layoutMemory: { ...memory, bsp: tab.layout },
    });
  }
  return updateTab(snapshot, {
    ...tab,
    layoutMode: mode,
    layout: reconcileBsp(memory.bsp, ids),
    layoutMemory: { ...memory, columns: tab.columns ?? [] },
  });
}

export function applyColumnChange(
  snapshot: WorkbenchSnapshot,
  columnId: string,
  change: { width?: number; direction?: -1 | 1; shares?: readonly number[] },
): WorkbenchSnapshot {
  const tab = getActiveTab(snapshot);
  if (tab.layoutMode !== "scrolling") return snapshot;
  const columns = [...(tab.columns ?? [])];
  const index = columns.findIndex((c) => c.id === columnId);
  const column = columns[index];
  if (!column) return snapshot;
  let updated = column;
  if (change.width !== undefined && Number.isFinite(change.width))
    updated = {
      ...updated,
      width: Math.max(MIN_COLUMN_WIDTH, Math.min(MAX_COLUMN_WIDTH, change.width)),
    };
  if (
    change.shares?.length === column.paneIds.length &&
    change.shares.every((n) => Number.isFinite(n) && n > 0)
  ) {
    const sum = change.shares.reduce((a, b) => a + b, 0);
    updated = { ...updated, shares: change.shares.map((n) => n / sum) };
  }
  columns[index] = updated;
  if (change.direction && columns[index + change.direction]) {
    columns[index] = columns[index + change.direction]!;
    columns[index + change.direction] = updated;
  }
  return updateTab(snapshot, { ...tab, columns, layout: columnsTree(columns) });
}

export function applyMoveInColumn(
  snapshot: WorkbenchSnapshot,
  paneId: string,
  direction: -1 | 1,
): WorkbenchSnapshot {
  const tab = getActiveTab(snapshot);
  const columns = tab.columns?.map((column) => {
    const index = column.paneIds.indexOf(paneId);
    if (index < 0 || !column.paneIds[index + direction]) return column;
    const paneIds = [...column.paneIds];
    [paneIds[index], paneIds[index + direction]] = [paneIds[index + direction]!, paneIds[index]!];
    return { ...column, paneIds };
  });
  return tab.layoutMode === "scrolling" && columns
    ? updateTab(snapshot, { ...tab, columns, layout: columnsTree(columns) })
    : snapshot;
}

function clearedTab(tab: WorkbenchTab, generateId: () => string): WorkbenchTab {
  return reconcileTab({
    ...welcomeTab(generateId),
    id: tab.id,
    titleMode: tab.titleMode,
    titleOverride: tab.titleOverride,
    layoutMode: tab.layoutMode ?? "bsp",
  });
}

function removeViewFromTab(
  tab: WorkbenchTab,
  paneId: string,
  generateId: () => string,
): WorkbenchTab | null {
  if (!tab.panes.has(paneId)) return null;
  const next = closeLeaf(tab, paneId);
  if (next === null) {
    return clearedTab(tab, generateId);
  }
  const panes = new Map(tab.panes);
  panes.delete(paneId);
  return reconcileTab({ ...tab, ...next, panes });
}

function insertViewIntoTab(
  tab: WorkbenchTab,
  paneId: string,
  view: ViewInstance,
  generateId: () => string,
): { readonly tab: WorkbenchTab; readonly paneId: string } {
  const existing = tab.panes.get(paneId);
  const resolvedPaneId =
    existing !== undefined && existing.target.kind !== "welcome" ? generateId() : paneId;
  const focused = tab.panes.get(tab.focusedPaneId);
  if (focused?.target.kind === "welcome") {
    const panes = new Map(tab.panes);
    panes.delete(tab.focusedPaneId);
    panes.set(resolvedPaneId, view);
    return {
      tab: {
        ...tab,
        layout: replaceLeafId(tab.layout, tab.focusedPaneId, resolvedPaneId),
        panes,
        focusedPaneId: resolvedPaneId,
      },
      paneId: resolvedPaneId,
    };
  }

  const panes = new Map(tab.panes);
  panes.set(resolvedPaneId, view);
  return {
    tab: {
      ...tab,
      ...placedLayout(tab, resolvedPaneId, tab.focusedPaneId, "right"),
      panes,
      focusedPaneId: resolvedPaneId,
    },
    paneId: resolvedPaneId,
  };
}

function insertPresentationTab(
  snapshot: WorkbenchSnapshot,
  view: ViewInstance,
  index: number,
  generateId: () => string,
  paneId = generateId(),
): ViewDropResult {
  const tab: WorkbenchTab = {
    ...newTab(paneId),
    panes: new Map([[paneId, view]]),
    titleMode: "auto",
    titleOverride: null,
  };
  const tabs = [...snapshot.tabs];
  tabs.splice(Math.max(0, Math.min(index, tabs.length)), 0, tab);
  return { snapshot: { tabs, activeTabId: tab.id }, tabId: tab.id, paneId };
}

function findNewAgentSessionPane(
  snapshot: WorkbenchSnapshot,
  target: Extract<ViewTarget, { kind: "newAgentSession" }>,
): { readonly tabId: string; readonly paneId: string } | null {
  for (const tab of snapshot.tabs) {
    for (const [paneId, view] of tab.panes) {
      if (
        view.target.kind === "newAgentSession" &&
        view.target.environmentId === target.environmentId &&
        view.target.workspaceId === target.workspaceId
      ) {
        return { tabId: tab.id, paneId };
      }
    }
  }
  return null;
}

/**
 * Focus an existing Session View across tabs (leftmost tab if multiple, or current tab if open in active tab);
 * otherwise replace an active Welcome View or create a new Tab next to the active Tab.
 */
export function applyOpenTarget(
  snapshot: WorkbenchSnapshot,
  target: ViewTarget,
  generateId: () => string,
): WorkbenchSnapshot {
  if (target.kind === "newAgentSession") {
    const existing = findNewAgentSessionPane(snapshot, target);
    if (existing !== null) {
      return applySetFocused(applyActivateTab(snapshot, existing.tabId), existing.paneId);
    }
  }

  // 1. If already open in the active Tab, focus it directly.
  const activeTab = getActiveTab(snapshot);
  const existingInActive = findPaneByTarget(activeTab, target);
  if (existingInActive !== null) return applySetFocused(snapshot, existingInActive);

  // 2. If already open in another Tab, activate the leftmost Tab containing it and focus.
  for (const tab of snapshot.tabs) {
    if (tab.id === activeTab.id) continue;
    const existingPaneId = findPaneByTarget(tab, target);
    if (existingPaneId !== null) {
      return applySetFocused(applyActivateTab(snapshot, tab.id), existingPaneId);
    }
  }

  // 3. Not open in any Tab:
  // 3a. If the active Tab is an empty Welcome Tab, replace it in-place.
  const isSoleWelcome =
    activeTab.panes.size === 1 && [...activeTab.panes.values()][0]?.target.kind === "welcome";

  if (isSoleWelcome) {
    const paneId = activeTab.focusedPaneId;
    const panes = new Map(activeTab.panes);
    panes.set(paneId, viewInstance(target, generateId));
    return updateTab(snapshot, { ...activeTab, panes });
  }

  // 3b. Otherwise, create a new Tab immediately to the right of the active Tab.
  const activeIndex = snapshot.tabs.findIndex((tab) => tab.id === snapshot.activeTabId);
  const insertIndex = activeIndex >= 0 ? activeIndex + 1 : snapshot.tabs.length;
  return insertPresentationTab(snapshot, viewInstance(target, generateId), insertIndex, generateId)
    .snapshot;
}

/**
 * Deep links are recovery inputs, not layout owners. Focus an existing target,
 * replace a sole Welcome View, or create a new Tab without mutating restored work.
 */
export function applyOpenDeepLinkTarget(
  snapshot: WorkbenchSnapshot,
  target: ViewTarget,
  generateId: () => string,
): WorkbenchSnapshot {
  return applyOpenTarget(snapshot, target, generateId);
}

export function applySplitPane(
  snapshot: WorkbenchSnapshot,
  sourcePaneId: string,
  target: ViewTarget,
  dir: SplitDir,
  generateId: () => string,
): WorkbenchSnapshot {
  if (target.kind === "newAgentSession") {
    const existing = findNewAgentSessionPane(snapshot, target);
    if (existing !== null) {
      return applySetFocused(applyActivateTab(snapshot, existing.tabId), existing.paneId);
    }
  }

  const tab = getActiveTab(snapshot);
  if (!tab.panes.has(sourcePaneId) || tab.panes.get(sourcePaneId)?.target.kind === "welcome") {
    return applyOpenTarget(snapshot, target, generateId);
  }
  const existing = findPaneByTarget(tab, target);
  if (existing !== null) return applySetFocused(snapshot, existing);
  const paneId = generateId();
  const panes = new Map(tab.panes);
  panes.set(paneId, viewInstance(target, generateId));
  return updateTab(snapshot, {
    ...tab,
    panes,
    ...placedLayout(tab, paneId, sourcePaneId, dir === "down" ? "bottom" : "right"),
    focusedPaneId: paneId,
  });
}

export function applySplitFocused(
  snapshot: WorkbenchSnapshot,
  target: ViewTarget,
  dir: SplitDir,
  generateId: () => string,
): WorkbenchSnapshot {
  const tab = getActiveTab(snapshot);
  return applySplitPane(snapshot, tab.focusedPaneId, target, dir, generateId);
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
  if (next === null) {
    return updateTab(snapshot, clearedTab(tab, generateId));
  }
  const panes = new Map(tab.panes);
  panes.delete(paneId);
  return updateTab(snapshot, { ...tab, ...next, panes });
}

export function applySetFocused(snapshot: WorkbenchSnapshot, paneId: string): WorkbenchSnapshot {
  const tab = getActiveTab(snapshot);
  if (!tab.panes.has(paneId) || tab.focusedPaneId === paneId) return snapshot;
  return updateTab(snapshot, { ...tab, focusedPaneId: paneId });
}

/** Replace a Pane's target while preserving the ViewInstance identity. */
export function applyReplacePaneTarget(
  snapshot: WorkbenchSnapshot,
  paneId: string,
  target: ViewTarget,
): WorkbenchSnapshot {
  const tab = getActiveTab(snapshot);
  const view = tab.panes.get(paneId);
  if (view === undefined) return snapshot;
  const existingPaneId = findPaneByTarget(tab, target);
  if (existingPaneId !== null && existingPaneId !== paneId) {
    const panes = new Map(tab.panes);
    panes.delete(paneId);
    const next = closeLeaf(tab, paneId);
    if (next === null) return applySetFocused(snapshot, existingPaneId);
    return updateTab(snapshot, {
      ...tab,
      ...next,
      panes,
      focusedPaneId: existingPaneId,
    });
  }
  const panes = new Map(tab.panes);
  panes.set(paneId, {
    ...view,
    definitionId: definitionIdForTarget(target),
    target,
  });
  return updateTab(snapshot, { ...tab, panes });
}

/** Apply one drag/drop transaction without owning runtime Session lifecycle. */
export function applyViewDrop(
  snapshot: WorkbenchSnapshot,
  source: ViewDragSource,
  target: ViewDropTarget,
  generateId: () => string,
): ViewDropResult | null {
  if (source.kind === "pane" && target.kind === "pane") {
    const sourceTab = snapshot.tabs.find((candidate) => candidate.id === source.tabId);
    const targetTab = snapshot.tabs.find((candidate) => candidate.id === target.tabId);
    if (
      sourceTab === undefined ||
      targetTab === undefined ||
      !sourceTab.panes.has(source.paneId) ||
      !targetTab.panes.has(target.paneId) ||
      source.paneId === target.paneId
    ) {
      return null;
    }
    if (sourceTab.id === targetTab.id) {
      const edge: PaneEdge = target.zone === "replace" ? "right" : target.zone;
      return {
        snapshot: updateTab(snapshot, {
          ...sourceTab,
          ...(sourceTab.layoutMode === "scrolling"
            ? placedLayout(sourceTab, source.paneId, target.paneId, edge)
            : { layout: movePane(sourceTab.layout, source.paneId, target.paneId, edge) }),
          focusedPaneId: source.paneId,
        }),
        tabId: sourceTab.id,
        paneId: source.paneId,
      };
    }
    const view = sourceTab.panes.get(source.paneId)!;
    if (findPaneByTarget(targetTab, view.target) !== null) return null;
    const sourceAfter = removeViewFromTab(sourceTab, source.paneId, generateId);
    if (!sourceAfter) return null;
    const panes = new Map(targetTab.panes);
    if (target.zone === "replace") panes.delete(target.paneId);
    panes.set(source.paneId, view);
    const targetAfter = reconcileTab({
      ...targetTab,
      ...placedLayout(targetTab, source.paneId, target.paneId, target.zone),
      panes,
      focusedPaneId: source.paneId,
    });
    return {
      snapshot: {
        ...snapshot,
        activeTabId: targetTab.id,
        tabs: snapshot.tabs.map((tab) =>
          tab.id === sourceTab.id ? sourceAfter : tab.id === targetTab.id ? targetAfter : tab,
        ),
      },
      tabId: targetTab.id,
      paneId: source.paneId,
    };
  }

  if (source.kind === "pane" && target.kind === "existingTab") {
    const sourceTab = snapshot.tabs.find((candidate) => candidate.id === source.tabId);
    const targetTab = snapshot.tabs.find((candidate) => candidate.id === target.tabId);
    if (
      sourceTab === undefined ||
      targetTab === undefined ||
      sourceTab.id === targetTab.id ||
      !sourceTab.panes.has(source.paneId) ||
      findPaneByTarget(targetTab, sourceTab.panes.get(source.paneId)!.target) !== null
    ) {
      return null;
    }
    const sourceView = sourceTab.panes.get(source.paneId);
    if (sourceView === undefined) return null;
    const inserted = insertViewIntoTab(targetTab, source.paneId, sourceView, generateId);
    const sourceAfter = removeViewFromTab(sourceTab, source.paneId, generateId);
    if (sourceAfter === null) return null;
    const tabs = snapshot.tabs.map((tab) => {
      if (tab.id === sourceTab.id) return sourceAfter;
      if (tab.id === targetTab.id) return reconcileTab(inserted.tab);
      return tab;
    });
    return {
      snapshot: { tabs, activeTabId: targetTab.id },
      tabId: targetTab.id,
      paneId: inserted.paneId,
    };
  }

  if (source.kind === "pane" && target.kind === "newTab") {
    const sourceTab = snapshot.tabs.find((candidate) => candidate.id === source.tabId);
    if (sourceTab === undefined || !sourceTab.panes.has(source.paneId)) return null;
    const sourceView = sourceTab.panes.get(source.paneId);
    if (sourceView === undefined) return null;
    const sourceAfter = removeViewFromTab(sourceTab, source.paneId, generateId);
    if (sourceAfter === null) return null;
    const nextSnapshot = {
      ...snapshot,
      tabs: snapshot.tabs.map((candidate) =>
        candidate.id === sourceTab.id ? sourceAfter : candidate,
      ),
    };
    return insertPresentationTab(nextSnapshot, sourceView, target.index, generateId, source.paneId);
  }

  if (source.kind === "sidebar" && target.kind === "existingTab") {
    const targetTab = snapshot.tabs.find((candidate) => candidate.id === target.tabId);
    if (targetTab === undefined) return null;
    const existingPaneId = findPaneByTarget(targetTab, source.target);
    if (existingPaneId !== null) {
      return {
        snapshot: applySetFocused(applyActivateTab(snapshot, targetTab.id), existingPaneId),
        tabId: targetTab.id,
        paneId: existingPaneId,
      };
    }
    const focused = targetTab.panes.get(targetTab.focusedPaneId);
    const paneId = focused?.target.kind === "welcome" ? targetTab.focusedPaneId : generateId();
    const inserted = insertViewIntoTab(
      targetTab,
      paneId,
      viewInstance(source.target, generateId),
      generateId,
    );
    return {
      snapshot: updateTab(applyActivateTab(snapshot, targetTab.id), inserted.tab),
      tabId: targetTab.id,
      paneId: inserted.paneId,
    };
  }

  if (source.kind === "sidebar" && target.kind === "newTab") {
    return insertPresentationTab(
      snapshot,
      viewInstance(source.target, generateId),
      target.index,
      generateId,
    );
  }

  if (source.kind !== "sidebar" || target.kind !== "pane") return null;
  const tab = snapshot.tabs.find((candidate) => candidate.id === target.tabId);
  if (tab === undefined || !tab.panes.has(target.paneId)) return null;
  const existingPaneId = findPaneByTarget(tab, source.target);
  if (existingPaneId !== null) {
    return {
      snapshot: applySetFocused(applyActivateTab(snapshot, tab.id), existingPaneId),
      tabId: tab.id,
      paneId: existingPaneId,
    };
  }

  if (target.zone === "replace") {
    const panes = new Map(tab.panes);
    panes.set(target.paneId, viewInstance(source.target, generateId));
    return {
      snapshot: updateTab(snapshot, { ...tab, panes, focusedPaneId: target.paneId }),
      tabId: tab.id,
      paneId: target.paneId,
    };
  }

  const paneId = generateId();
  const panes = new Map(tab.panes);
  panes.set(paneId, viewInstance(source.target, generateId));
  return {
    snapshot: updateTab(snapshot, {
      ...tab,
      panes,
      ...placedLayout(tab, paneId, target.paneId, target.zone),
      focusedPaneId: paneId,
    }),
    tabId: tab.id,
    paneId,
  };
}

/** Duplicate presentation into a new Tab without duplicating its work. */
export function applyDuplicateToNewTab(
  snapshot: WorkbenchSnapshot,
  source: ViewDuplicateSource,
  index: number,
  generateId: () => string,
): ViewDropResult | null {
  const sourceTarget = snapshot.tabs
    .find((tab) => tab.id === source.tabId)
    ?.panes.get(source.paneId)?.target;
  if (
    sourceTarget === undefined ||
    (sourceTarget.kind !== "agentSession" && sourceTarget.kind !== "workspaceTerminal")
  ) {
    return null;
  }

  return insertPresentationTab(snapshot, viewInstance(sourceTarget, generateId), index, generateId);
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

export function applyRenameTab(
  snapshot: WorkbenchSnapshot,
  tabId: string,
  title: string | null,
): WorkbenchSnapshot {
  const tab = snapshot.tabs.find((candidate) => candidate.id === tabId);
  if (tab === undefined) return snapshot;
  const trimmed = title?.trim() ?? "";
  return updateTab(snapshot, {
    ...tab,
    titleMode: trimmed.length === 0 ? "auto" : "manual",
    titleOverride: trimmed.length === 0 ? null : trimmed,
  });
}

export function applyCloseTab(snapshot: WorkbenchSnapshot, tabId: string): WorkbenchSnapshot {
  if (snapshot.tabs.length <= 1) return snapshot;
  const closingIndex = snapshot.tabs.findIndex((tab) => tab.id === tabId);
  if (closingIndex < 0) return snapshot;
  const tabs = snapshot.tabs.filter((tab) => tab.id !== tabId);
  if (snapshot.activeTabId !== tabId) return { ...snapshot, tabs };
  const nextActive = tabs[Math.min(closingIndex, tabs.length - 1)];
  return nextActive === undefined ? snapshot : { tabs, activeTabId: nextActive.id };
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

function applyRemoveMatchingViews(
  snapshot: WorkbenchSnapshot,
  matches: (target: ViewTarget) => boolean,
  generateId: () => string,
): WorkbenchSnapshot {
  let changed = false;
  const tabs = snapshot.tabs.map((tab) => {
    const matchingPaneIds: string[] = [];
    for (const [paneId, view] of tab.panes) {
      if (matches(view.target)) {
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
      return clearedTab(tab, generateId);
    }
    const validFocus = leafIds(currentTab.layout).includes(currentTab.focusedPaneId)
      ? currentTab.focusedPaneId
      : firstLeafId(currentTab.layout);
    return reconcileTab({
      ...tab,
      layout: currentTab.layout,
      focusedPaneId: validFocus,
      panes,
    });
  });

  return changed ? { ...snapshot, tabs } : snapshot;
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
  return applyRemoveMatchingViews(
    snapshot,
    (candidate) => isSameSessionTarget(candidate, target),
    generateId,
  );
}

/** Remove legacy Workspace overview Views from restored layouts. */
export function applyRemoveWorkspaceViews(
  snapshot: WorkbenchSnapshot,
  generateId: () => string,
): WorkbenchSnapshot {
  return applyRemoveMatchingViews(snapshot, (target) => target.kind === "workspace", generateId);
}

/** Remove the explicit New Agent Session View without deleting its draft payload. */
export function applyRemoveNewAgentSessionViews(
  snapshot: WorkbenchSnapshot,
  target: Extract<ViewTarget, { kind: "newAgentSession" }>,
  generateId: () => string,
): WorkbenchSnapshot {
  return applyRemoveMatchingViews(
    snapshot,
    (candidate) =>
      candidate.kind === "newAgentSession" &&
      candidate.environmentId === target.environmentId &&
      candidate.workspaceId === target.workspaceId &&
      candidate.draftId === target.draftId,
    generateId,
  );
}

export interface KnownWorkspace {
  readonly environmentId: string;
  readonly workspaceId: string;
}

/** Remove Views whose scoped Workspace is no longer present in projections. */
export function applyPruneWorkspaceViews(
  snapshot: WorkbenchSnapshot,
  knownWorkspaces: ReadonlyArray<KnownWorkspace>,
  generateId: () => string,
  observedEnvironmentIds: ReadonlyArray<string> = [],
): WorkbenchSnapshot {
  const known = new Set(
    knownWorkspaces.map((workspace) => `${workspace.environmentId}:${workspace.workspaceId}`),
  );
  const observedEnvironments = new Set(observedEnvironmentIds);
  return applyRemoveMatchingViews(
    snapshot,
    (target) => {
      switch (target.kind) {
        case "workspace":
        case "agentSession":
        case "newAgentSession":
        case "workspaceTerminal":
          return (
            observedEnvironments.has(target.environmentId) &&
            !known.has(`${target.environmentId}:${target.workspaceId}`)
          );
        case "project":
        case "welcome":
          return false;
      }
    },
    generateId,
  );
}
