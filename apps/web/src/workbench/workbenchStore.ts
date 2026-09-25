export interface PaneCloseGuard {
  readonly isDirty: () => boolean;
  readonly confirmClose: () => Promise<boolean>;
}
import { type LayoutMode } from "./scrollingLayout";
import { create } from "zustand";

import {
  applySetLayoutMode,
  applyColumnChange,
  applyMoveInColumn,
  applyCreateTab,
  applyMoveTab,
  applyDuplicateToNewTab,
  applyActivateTab,
  applyCloseTab,
  applyClosePane,
  applyRemoveSessionViews,
  applyReplacePaneTarget,
  applyRenameTab,
  applyOpenDeepLinkTarget,
  applyOpenTarget,
  applyPruneWorkspaceViews,
  applyRemoveWorkspaceViews,
  applySetFocused,
  applySetSplitRatio,
  applySplitPane,
  applySplitFocused,
  applyViewDrop,
  emptyWorkbenchSnapshot,
  type ViewDragSource,
  type ViewDropTarget,
  type ViewDropResult,
  type ViewDuplicateSource,
  type WorkbenchSnapshot,
} from "./workbenchState";
import type { SplitDir } from "./layout";
import type { ViewTarget } from "./viewRegistry";
import { readWorkbenchSnapshot, writeWorkbenchSnapshot } from "./workbenchPersistence";

export type ViewClosureListener = (targets: readonly ViewTarget[]) => void;

/** Public presentation commands; lifecycle observers own any Session cleanup. */
export interface WorkbenchStore extends WorkbenchSnapshot {
  readonly focusRequestId: number;
  setLayoutMode: (mode: LayoutMode) => void;
  changeColumn: (
    id: string,
    change: { width?: number; direction?: -1 | 1; shares?: readonly number[] },
  ) => void;
  moveInColumn: (paneId: string, direction: -1 | 1) => void;
  createTab: () => void;
  activateTab: (tabId: string) => void;
  closeTab: (tabId: string) => void;
  moveTab: (fromIndex: number, toIndex: number) => void;
  renameTab: (tabId: string, title: string | null) => void;
  closeView: (paneId: string) => void;
  removeSessionViews: (target: ViewTarget) => void;
  replaceTarget: (paneId: string, target: ViewTarget) => void;
  previewDrop: (source: ViewDragSource, target: ViewDropTarget) => ViewDropResult | null;
  commitDrop: (result: ViewDropResult) => void;
  duplicateToNewTab: (source: ViewDuplicateSource) => void;
  openTarget: (target: ViewTarget) => void;
  openDeepLinkTarget: (target: ViewTarget) => void;
  pruneWorkspaceViews: (
    workspaces: ReadonlyArray<{ readonly environmentId: string; readonly workspaceId: string }>,
    observedEnvironmentIds?: ReadonlyArray<string>,
  ) => void;
  splitFocused: (target: ViewTarget, dir: SplitDir) => void;
  splitPane: (paneId: string, target: ViewTarget, dir: SplitDir) => void;
  setFocused: (paneId: string) => void;
  setSplitRatio: (splitId: string, index: number, ratio: number) => void;
  registerCloseGuard: (paneId: string, guard: PaneCloseGuard) => () => void;
  requestClosePane: (paneId: string) => Promise<boolean>;
  canCloseTab: (tabId: string) => Promise<boolean>;
  subscribeViewClosures: (listener: ViewClosureListener) => () => void;
}

const defaultGenerateId = (): string => {
  const random = Math.random().toString(36).slice(2, 10);
  const stamp = Date.now().toString(36);
  return `id-${stamp}-${random}`;
};

export interface WorkbenchStoreOptions {
  readonly initialSnapshot?: WorkbenchSnapshot;
  readonly generateId?: () => string;
  readonly persist?: (snapshot: WorkbenchSnapshot) => void;
}

export function createWorkbenchStore(options: WorkbenchStoreOptions = {}) {
  const generateId = options.generateId ?? defaultGenerateId;
  const persist = options.persist ?? ((snapshot) => writeWorkbenchSnapshot(snapshot));
  const initialSnapshot = applyRemoveWorkspaceViews(
    options.initialSnapshot ?? readWorkbenchSnapshot() ?? emptyWorkbenchSnapshot(generateId),
    generateId,
  );
  const previews = new WeakMap<ViewDropResult, WorkbenchSnapshot>();
  const closeGuards = new Map<string, PaneCloseGuard>();
  const closureListeners = new Set<ViewClosureListener>();
  const notifyClosedViews = (before: WorkbenchSnapshot, after: WorkbenchSnapshot) => {
    const remaining = new Set(
      after.tabs.flatMap((tab) => [...tab.panes.values()].map((view) => view.id)),
    );
    const removed = before.tabs
      .flatMap((tab) => [...tab.panes.values()])
      .filter((view) => !remaining.has(view.id))
      .map((view) => view.target);
    if (removed.length > 0) for (const listener of closureListeners) listener(removed);
  };
  const store = create<WorkbenchStore>((set, get) => ({
    ...initialSnapshot,
    focusRequestId: 0,
    setLayoutMode: (mode) =>
      set((snapshot) => ({
        ...applySetLayoutMode(snapshot, mode),
        focusRequestId: snapshot.focusRequestId + 1,
      })),
    changeColumn: (id, change) => set((snapshot) => applyColumnChange(snapshot, id, change)),
    moveInColumn: (id, direction) => set((snapshot) => applyMoveInColumn(snapshot, id, direction)),
    createTab: () => set((snapshot) => applyCreateTab(snapshot, generateId)),
    activateTab: (tabId) => set((snapshot) => applyActivateTab(snapshot, tabId)),
    closeTab: (tabId) => {
      const previous = get();
      set(applyCloseTab(previous, tabId));
      notifyClosedViews(previous, get());
    },
    subscribeViewClosures: (listener) => {
      closureListeners.add(listener);
      return () => {
        closureListeners.delete(listener);
      };
    },
    moveTab: (fromIndex, toIndex) => set((snapshot) => applyMoveTab(snapshot, fromIndex, toIndex)),
    renameTab: (tabId, title) => set((snapshot) => applyRenameTab(snapshot, tabId, title)),
    registerCloseGuard: (paneId, guard) => {
      closeGuards.set(paneId, guard);
      return () => {
        if (closeGuards.get(paneId) === guard) {
          closeGuards.delete(paneId);
        }
      };
    },
    requestClosePane: async (paneId) => {
      const guard = closeGuards.get(paneId);
      if (guard && guard.isDirty()) {
        const allowed = await guard.confirmClose();
        if (!allowed) return false;
      }
      get().closeView(paneId);
      return true;
    },
    canCloseTab: async (tabId) => {
      const tab = get().tabs.find((t) => t.id === tabId);
      if (!tab) return true;
      for (const paneId of tab.panes.keys()) {
        const guard = closeGuards.get(paneId);
        if (guard && guard.isDirty()) {
          const allowed = await guard.confirmClose();
          if (!allowed) return false;
        }
      }
      return true;
    },
    closeView: (paneId) => {
      const previous = get();
      set(applyClosePane(previous, paneId, generateId) ?? previous);
      notifyClosedViews(previous, get());
    },
    removeSessionViews: (target) =>
      set((snapshot) => applyRemoveSessionViews(snapshot, target, generateId)),
    replaceTarget: (paneId, target) =>
      set((snapshot) => applyReplacePaneTarget(snapshot, paneId, target)),
    previewDrop: (source, target) => {
      const base = get();
      const result = applyViewDrop(base, source, target, generateId);
      if (result) previews.set(result, base);
      return result;
    },
    commitDrop: (result) =>
      set((snapshot) => {
        const base = previews.get(result);
        previews.delete(result);
        if (!base || base.tabs !== snapshot.tabs || base.activeTabId !== snapshot.activeTabId)
          return snapshot;
        return { ...result.snapshot, focusRequestId: snapshot.focusRequestId + 1 };
      }),
    duplicateToNewTab: (source) =>
      set((snapshot) => {
        const sourceIndex = snapshot.tabs.findIndex((tab) => tab.id === source.tabId);
        const index = sourceIndex < 0 ? snapshot.tabs.length : sourceIndex + 1;
        const result = applyDuplicateToNewTab(snapshot, source, index, generateId);
        return result === null
          ? snapshot
          : { ...result.snapshot, focusRequestId: snapshot.focusRequestId + 1 };
      }),
    openTarget: (target) =>
      set((snapshot) => ({
        ...applyOpenTarget(snapshot, target, generateId),
        focusRequestId: snapshot.focusRequestId + 1,
      })),
    openDeepLinkTarget: (target) =>
      set((snapshot) => ({
        ...applyOpenDeepLinkTarget(snapshot, target, generateId),
        focusRequestId: snapshot.focusRequestId + 1,
      })),
    pruneWorkspaceViews: (workspaces, observedEnvironmentIds) =>
      set((snapshot) =>
        applyPruneWorkspaceViews(snapshot, workspaces, generateId, observedEnvironmentIds),
      ),
    splitFocused: (target, dir) =>
      set((snapshot) => ({
        ...applySplitFocused(snapshot, target, dir, generateId),
        focusRequestId: snapshot.focusRequestId + 1,
      })),
    splitPane: (paneId, target, dir) =>
      set((snapshot) => ({
        ...applySplitPane(snapshot, paneId, target, dir, generateId),
        focusRequestId: snapshot.focusRequestId + 1,
      })),
    setFocused: (paneId) => set((snapshot) => applySetFocused(snapshot, paneId)),
    setSplitRatio: (splitId, index, ratio) =>
      set((snapshot) => applySetSplitRatio(snapshot, splitId, index, ratio)),
  }));

  store.subscribe((snapshot, previous) => {
    if (snapshot.tabs === previous.tabs && snapshot.activeTabId === previous.activeTabId) return;
    persist({ tabs: snapshot.tabs, activeTabId: snapshot.activeTabId });
  });
  return store;
}

export const useWorkbenchStore = createWorkbenchStore();

/** Test seam. Reset the store back to an empty workbench. */
export function resetWorkbenchStore(): void {
  useWorkbenchStore.setState({
    ...emptyWorkbenchSnapshot(defaultGenerateId),
    focusRequestId: 0,
  });
}
