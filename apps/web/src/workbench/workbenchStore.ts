import { create } from "zustand";

import {
  applyClosePane,
  applyOpenTarget,
  applySetFocused,
  applySetSplitRatio,
  applySplitFocused,
  emptyWorkbenchSnapshot,
  type WorkbenchSnapshot,
} from "./workbenchState.ts";
import type { SplitDir } from "./layout.ts";
import type { ViewTarget } from "./viewRegistry.ts";

/**
 * Zustand store wrapping the workbench snapshot.
 *
 * C10 keeps a single Tab in memory — `WorkbenchSnapshot` already models that.
 * C11 will introduce `tabs: WorkbenchSnapshot[]` plus an active tab index; the
 * API surface here is expected to widen then.
 */
export interface WorkbenchStore extends WorkbenchSnapshot {
  openTarget: (target: ViewTarget) => void;
  splitFocused: (target: ViewTarget, dir: SplitDir) => void;
  closePane: (paneId: string) => void;
  setFocused: (paneId: string) => void;
  setSplitRatio: (splitId: string, index: number, ratio: number) => void;
}

const generateId = (): string => {
  const random = Math.random().toString(36).slice(2, 10);
  const stamp = Date.now().toString(36);
  return `id-${stamp}-${random}`;
};

export const useWorkbenchStore = create<WorkbenchStore>((set) => ({
  ...emptyWorkbenchSnapshot(generateId),
  openTarget: (target) =>
    set((snapshot) => applyOpenTarget(snapshot, target, generateId)),
  splitFocused: (target, dir) =>
    set((snapshot) => applySplitFocused(snapshot, target, dir, generateId)),
  closePane: (paneId) =>
    set((snapshot) => {
      const next = applyClosePane(snapshot, paneId, generateId);
      return next ?? snapshot;
    }),
  setFocused: (paneId) => set((snapshot) => applySetFocused(snapshot, paneId)),
  setSplitRatio: (splitId, index, ratio) =>
    set((snapshot) => applySetSplitRatio(snapshot, splitId, index, ratio)),
}));

/** Test seam. Reset the store back to an empty workbench. */
export function resetWorkbenchStore(): void {
  useWorkbenchStore.setState({
    ...emptyWorkbenchSnapshot(generateId),
    openTarget: useWorkbenchStore.getState().openTarget,
    splitFocused: useWorkbenchStore.getState().splitFocused,
    closePane: useWorkbenchStore.getState().closePane,
    setFocused: useWorkbenchStore.getState().setFocused,
    setSplitRatio: useWorkbenchStore.getState().setSplitRatio,
  });
}