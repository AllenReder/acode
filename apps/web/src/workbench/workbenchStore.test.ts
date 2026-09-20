import { expect, it } from "vite-plus/test";
import type { AgentSessionId, EnvironmentId, WorkspaceId } from "@t3tools/contracts";

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
