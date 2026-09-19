import { describe, expect, it } from "vite-plus/test";

import type {
  AcodeProjectId,
  AgentSessionId,
  EnvironmentId,
  WorkspaceId,
} from "@t3tools/contracts";

import {
  getActiveTab,
  applyCreateTab,
  applyActivateTab,
  applyClosePane,
  applyOpenTarget,
  applySetFocused,
  applySetSplitRatio,
  applySplitFocused,
  emptyWorkbenchSnapshot,
  type WorkbenchSnapshot,
} from "./workbenchState";
import { leafIds } from "./layout";
import { terminalTargetForRuntime } from "./sessionTarget";
import type { ViewTarget } from "./viewRegistry";

const ENV_A: EnvironmentId = "env-a" as EnvironmentId;
const ENV_B: EnvironmentId = "env-b" as EnvironmentId;
const WS_A: WorkspaceId = "ws-a" as WorkspaceId;
const WS_B: WorkspaceId = "ws-b" as WorkspaceId;
const AGENT_X: AgentSessionId = "agent-x" as AgentSessionId;
const AGENT_Y: AgentSessionId = "agent-y" as AgentSessionId;

function agent(
  id: AgentSessionId,
  workspaceId: WorkspaceId = WS_A,
): Extract<ViewTarget, { kind: "agentSession" }> {
  return {
    kind: "agentSession",
    environmentId: ENV_A,
    workspaceId,
    agentSessionId: id,
  };
}

function terminal(
  id: string,
  workspaceId: WorkspaceId = WS_A,
): Extract<ViewTarget, { kind: "workspaceTerminal" }> {
  return terminalTargetForRuntime({
    environmentId: ENV_A,
    workspaceId,
    terminalId: id,
  });
}

/** Deterministic id generator for tests. */
function makeIds(): () => string {
  let n = 0;
  return () => `id-${++n}`;
}

describe("emptyWorkbenchSnapshot", () => {
  it("starts with an explicit active Tab containing one Welcome View", () => {
    const snap = emptyWorkbenchSnapshot(makeIds());
    expect(snap.tabs).toHaveLength(1);
    const tab = getActiveTab(snap);
    expect(tab.id).toBe(snap.activeTabId);
    expect(leafIds(tab.layout)).toEqual([tab.focusedPaneId]);
    expect(tab.panes.get(tab.focusedPaneId)).toMatchObject({
      definitionId: "welcome",
      target: { kind: "welcome" },
    });
  });
});

describe("applyOpenTarget", () => {
  it("creates a single pane carrying the target on an empty workbench", () => {
    const ids = makeIds();
    const before = emptyWorkbenchSnapshot(ids);
    const after = applyOpenTarget(before, agent(AGENT_X), ids);
    expect(getActiveTab(after).panes.size).toBe(1);
    expect(getActiveTab(after).panes.get(getActiveTab(after).focusedPaneId)?.target).toEqual(
      agent(AGENT_X),
    );
  });

  it("replaces the focused pane's target when no pane shares the target", () => {
    const ids = makeIds();
    let snap = emptyWorkbenchSnapshot(ids);
    snap = applyOpenTarget(snap, agent(AGENT_X), ids);
    const focusBefore = getActiveTab(snap).focusedPaneId;
    snap = applyOpenTarget(snap, terminal("term-1"), ids);
    expect(getActiveTab(snap).panes.size).toBe(1);
    expect(getActiveTab(snap).panes.get(focusBefore)?.target).toEqual(terminal("term-1"));
    expect(getActiveTab(snap).focusedPaneId).toBe(focusBefore);
  });

  it("focuses the existing pane when the target is already open", () => {
    const ids = makeIds();
    let snap = emptyWorkbenchSnapshot(ids);
    snap = applyOpenTarget(snap, agent(AGENT_X), ids);
    const firstFocus = getActiveTab(snap).focusedPaneId;
    snap = applySplitFocused(snap, terminal("term-1"), "right", ids);
    const secondPaneId = findOtherLeaf(snap, firstFocus);
    snap = applySetFocused(snap, secondPaneId);
    snap = applyOpenTarget(snap, agent(AGENT_X), ids);
    expect(getActiveTab(snap).focusedPaneId).toBe(firstFocus);
    expect(getActiveTab(snap).panes.size).toBe(2);
  });
});

describe("applySplitFocused", () => {
  it("creates a new pane adjacent to the focused one", () => {
    const ids = makeIds();
    let snap = emptyWorkbenchSnapshot(ids);
    snap = applyOpenTarget(snap, agent(AGENT_X), ids);
    const focusBefore = getActiveTab(snap).focusedPaneId;
    snap = applySplitFocused(snap, terminal("term-1"), "right", ids);
    expect(getActiveTab(snap).panes.size).toBe(2);
    expect(getActiveTab(snap).panes.get(focusBefore)?.target).toEqual(agent(AGENT_X));
    const newFocus = findOtherLeaf(snap, focusBefore);
    expect(getActiveTab(snap).panes.get(newFocus)?.target).toEqual(terminal("term-1"));
    expect(getActiveTab(snap).focusedPaneId).toBe(newFocus);
  });

  it("honors the requested split direction", () => {
    const ids = makeIds();
    let snap = emptyWorkbenchSnapshot(ids);
    snap = applyOpenTarget(snap, agent(AGENT_X), ids);
    snap = applySplitFocused(snap, terminal("term-1"), "down", ids);
    expect(getActiveTab(snap).layout.type).toBe("split");
    const layout = getActiveTab(snap).layout;
    if (layout.type !== "split") throw new Error("expected split");
    expect(layout.dir).toBe("down");
  });
});

describe("applyClosePane", () => {
  it("removes the pane from both the layout and the pane map", () => {
    const ids = makeIds();
    let snap = emptyWorkbenchSnapshot(ids);
    snap = applyOpenTarget(snap, agent(AGENT_X), ids);
    snap = applySplitFocused(snap, terminal("term-1"), "right", ids);
    const terminalPaneId = getActiveTab(snap).focusedPaneId;
    const next = applyClosePane(snap, terminalPaneId, ids);
    expect(next).not.toBeNull();
    if (next === null) return;
    snap = next;
    expect(getActiveTab(snap).panes.size).toBe(1);
    expect(getActiveTab(snap).panes.has(terminalPaneId)).toBe(false);
    expect(getActiveTab(snap).focusedPaneId).not.toBe(terminalPaneId);
  });

  it("restores Welcome in the same Tab when the last pane closes", () => {
    const ids = makeIds();
    let snap = emptyWorkbenchSnapshot(ids);
    snap = applyOpenTarget(snap, agent(AGENT_X), ids);
    const onlyPane = getActiveTab(snap).focusedPaneId;
    const reset = applyClosePane(snap, onlyPane, ids);
    expect(reset).not.toBeNull();
    if (reset === null) return;
    snap = reset;
    expect(getActiveTab(snap).panes.size).toBe(1);
    expect(getActiveTab(snap).panes.get(getActiveTab(snap).focusedPaneId)?.target).toEqual({
      kind: "welcome",
    });
    expect(getActiveTab(snap).layout.type).toBe("leaf");
    // The new empty workbench should not retain the closed Session — opening
    // the same target again creates a fresh pane.
    snap = applyOpenTarget(snap, agent(AGENT_X), ids);
    expect(getActiveTab(snap).panes.size).toBe(1);
  });

  it("returns null when there is nothing to close", () => {
    const ids = makeIds();
    const snap = emptyWorkbenchSnapshot(ids);
    expect(applyClosePane(snap, "no-such-pane", ids)).toBeNull();
  });
});

describe("applySetFocused", () => {
  it("moves focus to the requested leaf", () => {
    const ids = makeIds();
    let snap = emptyWorkbenchSnapshot(ids);
    snap = applyOpenTarget(snap, agent(AGENT_X), ids);
    snap = applySplitFocused(snap, terminal("term-1"), "right", ids);
    const first = findOtherLeaf(snap, getActiveTab(snap).focusedPaneId);
    snap = applySetFocused(snap, first);
    expect(getActiveTab(snap).focusedPaneId).toBe(first);
  });

  it("returns the same snapshot when the pane id is unknown", () => {
    const ids = makeIds();
    const snap = emptyWorkbenchSnapshot(ids);
    expect(applySetFocused(snap, "unknown")).toBe(snap);
  });
});

describe("applySetSplitRatio", () => {
  it("updates the boundary between two panes in a split", () => {
    const ids = makeIds();
    let snap = emptyWorkbenchSnapshot(ids);
    snap = applyOpenTarget(snap, agent(AGENT_X), ids);
    snap = applySplitFocused(snap, terminal("term-1"), "right", ids);
    const splitId =
      getActiveTab(snap).layout.type === "split" ? getActiveTab(snap).layout.id : null;
    expect(splitId).not.toBeNull();
    if (splitId === null) throw new Error("expected split");
    snap = applySetSplitRatio(snap, splitId, 0, 0.7);
    expect(getActiveTab(snap).layout.type).toBe("split");
    const layout = getActiveTab(snap).layout;
    if (layout.type !== "split") throw new Error("expected split");
    expect(layout.sizes[0]).toBeCloseTo(0.7);
    expect(layout.sizes[1]).toBeCloseTo(0.3);
  });
});

describe("isolation between panes", () => {
  it("splitting an existing Session focuses its View without duplicating it", () => {
    const ids = makeIds();
    let snap = applyOpenTarget(emptyWorkbenchSnapshot(ids), agent(AGENT_X), ids);
    const first = getActiveTab(snap).focusedPaneId;
    const view = getActiveTab(snap).panes.get(first);
    snap = applySplitFocused(snap, terminal("term-1"), "down", ids);
    snap = applySplitFocused(snap, agent(AGENT_X), "right", ids);
    expect(getActiveTab(snap).panes.size).toBe(2);
    expect(getActiveTab(snap).focusedPaneId).toBe(first);
    expect(getActiveTab(snap).panes.get(first)).toBe(view);
  });

  it("keeps each pane's target intact across focus changes", () => {
    const ids = makeIds();
    let snap = emptyWorkbenchSnapshot(ids);
    snap = applyOpenTarget(snap, agent(AGENT_X), ids);
    const first = getActiveTab(snap).focusedPaneId;
    snap = applySplitFocused(snap, terminal("term-1"), "right", ids);
    const second = findOtherLeaf(snap, first);
    snap = applySetFocused(snap, first);
    expect(getActiveTab(snap).panes.get(first)?.target).toEqual(agent(AGENT_X));
    expect(getActiveTab(snap).panes.get(second)?.target).toEqual(terminal("term-1"));
  });
});

function findOtherLeaf(snap: WorkbenchSnapshot, paneId: string): string {
  const ids = leafIds(getActiveTab(snap).layout);
  const other = ids.find((id) => id !== paneId);
  if (!other) throw new Error("expected at least one other leaf");
  return other;
}
it("replaces Welcome when the first command is split", () => {
  const ids = makeIds();
  const snap = applySplitFocused(emptyWorkbenchSnapshot(ids), terminal("first"), "down", ids);
  expect(getActiveTab(snap).panes.size).toBe(1);
  expect([...getActiveTab(snap).panes.values()][0]?.target).toEqual(terminal("first"));
});

it("keeps Session Views and closeView local to each Tab", () => {
  const ids = makeIds();
  let snap = applyOpenTarget(emptyWorkbenchSnapshot(ids), agent(AGENT_X), ids);
  const firstTab = getActiveTab(snap);
  snap = applyCreateTab(snap, ids);
  snap = applyOpenTarget(snap, agent(AGENT_X), ids);
  const secondTab = getActiveTab(snap);
  expect(snap.tabs).toHaveLength(2);
  expect(secondTab.panes.get(secondTab.focusedPaneId)?.id).not.toBe(
    firstTab.panes.get(firstTab.focusedPaneId)?.id,
  );
  snap = applyClosePane(snap, secondTab.focusedPaneId, ids)!;
  expect(getActiveTab(snap).id).toBe(secondTab.id);
  expect(getActiveTab(snap).panes.get(getActiveTab(snap).focusedPaneId)?.definitionId).toBe(
    "welcome",
  );
  snap = applyActivateTab(snap, firstTab.id);
  expect(getActiveTab(snap)).toBe(firstTab);
  snap = applySplitFocused(snap, agent(AGENT_X), "down", ids);
  expect(getActiveTab(snap).panes.size).toBe(1);
  expect(applyActivateTab(snap, "unknown")).toBe(snap);
});

it("opens Project and Workspace independently even with the same definition and local id", () => {
  const ids = makeIds();
  const project: ViewTarget = {
    kind: "project",
    definitionId: "overview",
    environmentId: ENV_A,
    projectId: "shared" as AcodeProjectId,
  };
  const workspace: ViewTarget = {
    kind: "workspace",
    definitionId: "overview",
    environmentId: ENV_A,
    workspaceId: "shared" as WorkspaceId,
  };
  const initial = applyOpenTarget(emptyWorkbenchSnapshot(ids), project, ids);
  const split = applySplitFocused(initial, workspace, "right", ids);
  expect([...getActiveTab(split).panes.values()].map((view) => view.target)).toEqual([
    project,
    workspace,
  ]);
});
