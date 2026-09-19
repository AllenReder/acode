import { create } from "zustand";

import {
  applyCreateTab,
  applyActivateTab,
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

/** Public presentation commands; none owns Session runtime lifecycle. */
export interface WorkbenchStore extends WorkbenchSnapshot {
  createTab: () => void;
  activateTab: (tabId: string) => void;
  closeView: (paneId: string) => void;
  openTarget: (target: ViewTarget) => void;
  splitFocused: (target: ViewTarget, dir: SplitDir) => void;
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
  createTab: () => set((snapshot) => applyCreateTab(snapshot, generateId)),
  activateTab: (tabId) => set((snapshot) => applyActivateTab(snapshot, tabId)),
  closeView: (paneId) =>
    set((snapshot) => applyClosePane(snapshot, paneId, generateId) ?? snapshot),
  openTarget: (target) => set((snapshot) => applyOpenTarget(snapshot, target, generateId)),
  splitFocused: (target, dir) =>
    set((snapshot) => applySplitFocused(snapshot, target, dir, generateId)),
  setFocused: (paneId) => set((snapshot) => applySetFocused(snapshot, paneId)),
  setSplitRatio: (splitId, index, ratio) =>
    set((snapshot) => applySetSplitRatio(snapshot, splitId, index, ratio)),
}));

/** Test seam. Reset the store back to an empty workbench. */
export function resetWorkbenchStore(): void {
  useWorkbenchStore.setState(emptyWorkbenchSnapshot(generateId));
}
