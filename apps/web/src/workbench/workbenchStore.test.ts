import { expect, it } from "vite-plus/test";
import type { AgentSessionId, EnvironmentId, WorkspaceId } from "@awen/contracts";

import type { ViewTarget } from "./viewRegistry";
import {
  applyCreateTab,
  applyOpenTarget,
  emptyWorkbenchSnapshot,
  getActiveTab,
  type WorkbenchSnapshot,
} from "./workbenchState";
import { createWorkbenchStore } from "./workbenchStore";

const ENV_A: EnvironmentId = "env-a" as EnvironmentId;
const WS_A: WorkspaceId = "ws-a" as WorkspaceId;
const AGENT_A: AgentSessionId = "agent-a" as AgentSessionId;
const WORKSPACE_A: WorkspaceId = "workspace-a" as WorkspaceId;

function agent(): Extract<ViewTarget, { kind: "agentSession" }> {
  return {
    kind: "agentSession",
    environmentId: ENV_A,
    workspaceId: WS_A,
    agentSessionId: AGENT_A,
  };
}

function makeIds(): () => string {
  let n = 100;
  return () => `id-${++n}`;
}

it("restores a snapshot and persists later Tab transitions", () => {
  const ids = makeIds();
  const initial = applyOpenTarget(emptyWorkbenchSnapshot(ids), agent(), ids);
  const writes: WorkbenchSnapshot[] = [];
  const store = createWorkbenchStore({
    initialSnapshot: initial,
    generateId: ids,
    persist: (snapshot) => writes.push(snapshot),
  });

  expect(store.getState().tabs).toEqual(initial.tabs);
  store.getState().createTab();
  store.getState().renameTab(store.getState().activeTabId, "Manual title");

  expect(writes).toHaveLength(2);
  expect(writes[1]?.tabs).toHaveLength(2);
  expect(writes[1]?.tabs[1]?.titleMode).toBe("manual");
  expect(writes[1]?.tabs[1]?.titleOverride).toBe("Manual title");
});

it("opens a deep link without replacing restored layout", () => {
  const ids = makeIds();
  let initial = applyOpenTarget(emptyWorkbenchSnapshot(ids), agent(), ids);
  const originalPaneIds = [...getActiveTab(initial).panes.keys()];
  initial = applyCreateTab(initial, ids);
  const store = createWorkbenchStore({ initialSnapshot: initial, generateId: ids });

  store.getState().openDeepLinkTarget(agent());

  expect(store.getState().tabs).toHaveLength(2);
  expect(store.getState().tabs[0]?.panes).toHaveProperty("size", 1);
  expect([...store.getState().tabs[0]!.panes.keys()]).toEqual(originalPaneIds);
  expect(store.getState().activeTabId).toBe(store.getState().tabs[0]?.id);
});

it("duplicates presentation into a new Tab without mutating the source", () => {
  const ids = makeIds();
  const initial = applyOpenTarget(emptyWorkbenchSnapshot(ids), agent(), ids);
  const sourceTab = getActiveTab(initial);
  const sourcePaneId = sourceTab.focusedPaneId;
  const sourceView = sourceTab.panes.get(sourcePaneId)!;
  const store = createWorkbenchStore({ initialSnapshot: initial, generateId: ids });

  store.getState().duplicateToNewTab({ kind: "pane", tabId: sourceTab.id, paneId: sourcePaneId });

  expect(store.getState().tabs).toHaveLength(2);
  expect(store.getState().tabs[0]?.panes.get(sourcePaneId)).toBe(sourceView);
  const duplicate = store.getState().tabs[1]!;
  expect(duplicate.panes.size).toBe(1);
  expect([...duplicate.panes.values()][0]?.id).not.toBe(sourceView.id);
  expect([...duplicate.panes.values()][0]?.target).toEqual(agent());
});

it("keeps drag preview out of persisted Workbench state until the exact result is committed", () => {
  const ids = makeIds();
  const initial = applyOpenTarget(emptyWorkbenchSnapshot(ids), agent(), ids);
  const sourceTab = getActiveTab(initial);
  const sourcePaneId = sourceTab.focusedPaneId;
  const writes: WorkbenchSnapshot[] = [];
  const store = createWorkbenchStore({
    initialSnapshot: initial,
    generateId: ids,
    persist: (snapshot) => writes.push(snapshot),
  });

  const preview = store
    .getState()
    .previewDrop(
      { kind: "pane", tabId: sourceTab.id, paneId: sourcePaneId },
      { kind: "newTab", index: 1 },
    );

  expect(preview).not.toBeNull();
  expect(store.getState().tabs).toEqual(initial.tabs);
  expect(writes).toEqual([]);

  store.getState().commitDrop(preview!);

  expect(store.getState().tabs).toEqual(preview!.snapshot.tabs);
  expect(writes).toHaveLength(1);
});

it("drops legacy Workspace Views when restoring a Workbench layout", () => {
  const ids = makeIds();
  const legacyWorkspace = {
    kind: "workspace",
    environmentId: ENV_A,
    workspaceId: WORKSPACE_A,
  } as const;
  const restored = applyOpenTarget(emptyWorkbenchSnapshot(ids), legacyWorkspace, ids);

  const store = createWorkbenchStore({ initialSnapshot: restored, generateId: ids });
  const tab = getActiveTab(store.getState());

  expect(tab.panes.size).toBe(1);
  expect(tab.panes.get(tab.focusedPaneId)?.target).toEqual({ kind: "welcome" });
});

it("intercepts pane closure with registered close guard when dirty", async () => {
  const ids = makeIds();
  const initial = applyOpenTarget(emptyWorkbenchSnapshot(ids), agent(), ids);
  const tab = getActiveTab(initial);
  const paneId = tab.focusedPaneId;
  const store = createWorkbenchStore({ initialSnapshot: initial, generateId: ids });

  let isDirty = true;
  let confirmResult = false;
  const unregister = store.getState().registerCloseGuard(paneId, {
    isDirty: () => isDirty,
    confirmClose: async () => confirmResult,
  });

  // When dirty and user cancels confirmation -> pane is NOT closed
  const closed1 = await store.getState().requestClosePane(paneId);
  expect(closed1).toBe(false);
  expect(getActiveTab(store.getState()).panes.has(paneId)).toBe(true);

  // When dirty and user confirms -> pane IS closed
  confirmResult = true;
  const closed2 = await store.getState().requestClosePane(paneId);
  expect(closed2).toBe(true);
  expect(getActiveTab(store.getState()).panes.has(paneId)).toBe(false);
});

it("canCloseTab checks close guards for all panes in the tab", async () => {
  const ids = makeIds();
  const initial = applyOpenTarget(emptyWorkbenchSnapshot(ids), agent(), ids);
  const tab = getActiveTab(initial);
  const paneId = tab.focusedPaneId;
  const store = createWorkbenchStore({ initialSnapshot: initial, generateId: ids });

  let isDirty = true;
  let confirmResult = false;
  store.getState().registerCloseGuard(paneId, {
    isDirty: () => isDirty,
    confirmClose: async () => confirmResult,
  });

  // When dirty and user cancels confirmation -> canCloseTab returns false
  const canClose1 = await store.getState().canCloseTab(tab.id);
  expect(canClose1).toBe(false);

  // When dirty and user confirms -> canCloseTab returns true
  confirmResult = true;
  const canClose2 = await store.getState().canCloseTab(tab.id);
  expect(canClose2).toBe(true);

  // When clean -> canCloseTab returns true without confirmation
  isDirty = false;
  const canClose3 = await store.getState().canCloseTab(tab.id);
  expect(canClose3).toBe(true);
});

it("splits relative to a specific pane and focuses existing targets if already present", () => {
  const ids = makeIds();
  const initial = applyOpenTarget(emptyWorkbenchSnapshot(ids), agent(), ids);
  const tab = getActiveTab(initial);
  const sourcePaneId = tab.focusedPaneId;
  const store = createWorkbenchStore({ initialSnapshot: initial, generateId: ids });

  const fileTarget: ViewTarget = {
    kind: "workspace",
    definitionId: "fileView",
    environmentId: ENV_A,
    workspaceId: WS_A,
  };

  store.getState().splitPane(sourcePaneId, fileTarget, "right");
  const tabAfterSplit = getActiveTab(store.getState());
  expect(tabAfterSplit.panes.size).toBe(2);
  const filePaneId = tabAfterSplit.focusedPaneId;
  expect(tabAfterSplit.panes.get(filePaneId)?.target).toEqual(fileTarget);

  store.getState().setFocused(sourcePaneId);
  expect(getActiveTab(store.getState()).focusedPaneId).toBe(sourcePaneId);

  store.getState().splitPane(sourcePaneId, fileTarget, "right");
  const tabAfterRefocus = getActiveTab(store.getState());
  expect(tabAfterRefocus.panes.size).toBe(2);
  expect(tabAfterRefocus.focusedPaneId).toBe(filePaneId);
});

it("moves a tab from one index to another and persists the new order", () => {
  const ids = makeIds();
  let initial = applyOpenTarget(emptyWorkbenchSnapshot(ids), agent(), ids);
  initial = applyCreateTab(initial, ids);
  initial = applyCreateTab(initial, ids);

  const writes: WorkbenchSnapshot[] = [];
  const store = createWorkbenchStore({
    initialSnapshot: initial,
    generateId: ids,
    persist: (snapshot) => writes.push(snapshot),
  });

  const tab0Id = store.getState().tabs[0]!.id;
  const tab1Id = store.getState().tabs[1]!.id;
  const tab2Id = store.getState().tabs[2]!.id;

  // Move tab 0 to index 2
  store.getState().moveTab(0, 2);

  expect(store.getState().tabs.map((t) => t.id)).toEqual([tab1Id, tab2Id, tab0Id]);
  expect(writes).toHaveLength(1);
  expect(writes[0]!.tabs.map((t) => t.id)).toEqual([tab1Id, tab2Id, tab0Id]);

  // Invalid indices should no-op
  store.getState().moveTab(0, 0);
  store.getState().moveTab(-1, 2);
  store.getState().moveTab(0, 99);
  expect(writes).toHaveLength(1);
});

it("previews and commits a Tab drop to reorder tabs", () => {
  const ids = makeIds();
  let initial = applyOpenTarget(emptyWorkbenchSnapshot(ids), agent(), ids);
  initial = applyCreateTab(initial, ids);
  initial = applyCreateTab(initial, ids);

  const writes: WorkbenchSnapshot[] = [];
  const store = createWorkbenchStore({
    initialSnapshot: initial,
    generateId: ids,
    persist: (snapshot) => writes.push(snapshot),
  });

  const tab0Id = store.getState().tabs[0]!.id;
  const tab1Id = store.getState().tabs[1]!.id;
  const tab2Id = store.getState().tabs[2]!.id;

  // Drag tab 0 to existingTab 2
  const preview = store
    .getState()
    .previewDrop({ kind: "tab", tabId: tab0Id }, { kind: "existingTab", tabId: tab2Id });

  expect(preview).not.toBeNull();
  expect(preview!.snapshot.tabs.map((t) => t.id)).toEqual([tab1Id, tab2Id, tab0Id]);
  expect(store.getState().tabs.map((t) => t.id)).toEqual([tab0Id, tab1Id, tab2Id]);
  expect(writes).toHaveLength(0);

  store.getState().commitDrop(preview!);
  expect(store.getState().tabs.map((t) => t.id)).toEqual([tab1Id, tab2Id, tab0Id]);
  expect(writes).toHaveLength(1);
});
