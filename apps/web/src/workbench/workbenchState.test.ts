import { describe, expect, it } from "vite-plus/test";

import type {
  AcodeProjectId,
  AgentSessionId,
  EnvironmentId,
  WorkspaceId,
} from "@t3tools/contracts";
import type { DraftId } from "../composerDraftStore";

import {
  getActiveTab,
  applyCreateTab,
  applyActivateTab,
  applyClosePane,
  applyRemoveSessionViews,
  applyOpenTarget,
  applySetFocused,
  applySetSplitRatio,
  applySplitFocused,
  applyRemoveNewAgentSessionViews,
  applyReplacePaneTarget,
  applyPruneWorkspaceViews,
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
const DRAFT_X: DraftId = "draft-x" as DraftId;

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

function newAgentSession(
  draftId: DraftId = DRAFT_X,
  workspaceId: WorkspaceId = WS_A,
): Extract<ViewTarget, { kind: "newAgentSession" }> {
  return {
    kind: "newAgentSession",
    environmentId: ENV_A,
    workspaceId,
    draftId,
  };
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
    expect(getActiveTab(snap).panes.size).toBe(2);
    expect(getActiveTab(snap).panes.get(focusBefore)?.target).toEqual(agent(AGENT_X));
    expect(getActiveTab(snap).focusedPaneId).not.toBe(focusBefore);
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

  it("adds a right-side pane for a second distinct target while preserving the first", () => {
    const ids = makeIds();
    let snap = emptyWorkbenchSnapshot(ids);
    snap = applyOpenTarget(snap, agent(AGENT_X), ids);
    const firstPaneId = getActiveTab(snap).focusedPaneId;
    snap = applyOpenTarget(snap, agent(AGENT_Y), ids);
    const secondPaneId = getActiveTab(snap).focusedPaneId;

    expect(getActiveTab(snap).panes.size).toBe(2);
    expect(getActiveTab(snap).panes.get(firstPaneId)?.target).toEqual(agent(AGENT_X));
    expect(getActiveTab(snap).panes.get(secondPaneId)?.target).toEqual(agent(AGENT_Y));
    expect(getActiveTab(snap).layout).toMatchObject({ type: "split", dir: "right" });
  });

  it("focuses the existing New Agent Session draft instead of duplicating it in another Tab", () => {
    const ids = makeIds();
    let snap = applyOpenTarget(emptyWorkbenchSnapshot(ids), newAgentSession(), ids);
    const firstTabId = snap.activeTabId;
    const firstPaneId = getActiveTab(snap).focusedPaneId;

    snap = applyCreateTab(snap, ids);
    snap = applyOpenTarget(snap, newAgentSession(), ids);

    expect(snap.tabs).toHaveLength(2);
    expect(snap.activeTabId).toBe(firstTabId);
    expect(getActiveTab(snap).focusedPaneId).toBe(firstPaneId);
    expect(
      snap.tabs.reduce(
        (count, tab) =>
          count +
          [...tab.panes.values()].filter((view) => view.target.kind === "newAgentSession").length,
        0,
      ),
    ).toBe(1);
  });

  it("keeps at most one New Agent Session View for a Workspace", () => {
    const ids = makeIds();
    const firstDraft = newAgentSession(DRAFT_X);
    let snap = applyOpenTarget(emptyWorkbenchSnapshot(ids), firstDraft, ids);
    const firstPaneId = getActiveTab(snap).focusedPaneId;

    snap = applyOpenTarget(snap, newAgentSession("draft-y" as DraftId), ids);

    expect(getActiveTab(snap).focusedPaneId).toBe(firstPaneId);
    expect(
      [...getActiveTab(snap).panes.values()].filter(
        (view) => view.target.kind === "newAgentSession",
      ),
    ).toEqual([expect.objectContaining({ target: firstDraft })]);
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

  it("focuses the existing Workspace draft instead of splitting a second New Agent Session", () => {
    const ids = makeIds();
    let snap = applyOpenTarget(emptyWorkbenchSnapshot(ids), newAgentSession(DRAFT_X), ids);
    const firstPaneId = getActiveTab(snap).focusedPaneId;
    snap = applySplitFocused(snap, newAgentSession("draft-y" as DraftId), "right", ids);
    expect(getActiveTab(snap).panes.size).toBe(1);
    expect(getActiveTab(snap).focusedPaneId).toBe(firstPaneId);
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

describe("applyRemoveSessionViews", () => {
  it("removes matching session across multiple tabs while leaving unrelated tabs and panes intact", () => {
    const ids = makeIds();
    // Tab 1: Agent X + Terminal 1
    let snap = applyOpenTarget(emptyWorkbenchSnapshot(ids), agent(AGENT_X), ids);
    snap = applySplitFocused(snap, terminal("term-1"), "right", ids);
    const tab1Id = snap.activeTabId;

    // Tab 2: Agent X + Agent Y
    snap = applyCreateTab(snap, ids);
    snap = applyOpenTarget(snap, agent(AGENT_X), ids);
    snap = applySplitFocused(snap, agent(AGENT_Y), "right", ids);
    const tab2Id = snap.activeTabId;

    // Tab 3: Agent Y + Terminal 1 (unrelated to Agent X)
    snap = applyCreateTab(snap, ids);
    snap = applyOpenTarget(snap, agent(AGENT_Y), ids);
    snap = applySplitFocused(snap, terminal("term-1"), "right", ids);
    const tab3Id = snap.activeTabId;

    const tab3Before = snap.tabs.find((t) => t.id === tab3Id)!;

    // Remove Agent X across all tabs
    const after = applyRemoveSessionViews(snap, agent(AGENT_X), ids);

    // Tab 1 should now only have Terminal 1
    const tab1After = after.tabs.find((t) => t.id === tab1Id)!;
    expect(tab1After.panes.size).toBe(1);
    expect([...tab1After.panes.values()][0]?.target).toEqual(terminal("term-1"));
    expect(tab1After.focusedPaneId).toBe([...tab1After.panes.keys()][0]);

    // Tab 2 should now only have Agent Y
    const tab2After = after.tabs.find((t) => t.id === tab2Id)!;
    expect(tab2After.panes.size).toBe(1);
    expect([...tab2After.panes.values()][0]?.target).toEqual(agent(AGENT_Y));

    // Tab 3 was completely unaffected
    const tab3After = after.tabs.find((t) => t.id === tab3Id)!;
    expect(tab3After).toBe(tab3Before);

    // activeTabId preserved
    expect(after.activeTabId).toBe(snap.activeTabId);
  });

  it("restores Welcome in a tab if the removed session was its only pane", () => {
    const ids = makeIds();
    let snap = applyOpenTarget(emptyWorkbenchSnapshot(ids), agent(AGENT_X), ids);
    const tab1Id = snap.activeTabId;

    snap = applyCreateTab(snap, ids);
    snap = applyOpenTarget(snap, agent(AGENT_X), ids);
    const tab2Id = snap.activeTabId;

    const after = applyRemoveSessionViews(snap, agent(AGENT_X), ids);

    // Both tabs should recover to Welcome, preserving their Tab IDs
    const tab1After = after.tabs.find((t) => t.id === tab1Id)!;
    expect(tab1After.id).toBe(tab1Id);
    expect(tab1After.panes.size).toBe(1);
    expect([...tab1After.panes.values()][0]?.target).toEqual({ kind: "welcome" });

    const tab2After = after.tabs.find((t) => t.id === tab2Id)!;
    expect(tab2After.id).toBe(tab2Id);
    expect(tab2After.panes.size).toBe(1);
    expect([...tab2After.panes.values()][0]?.target).toEqual({ kind: "welcome" });
  });

  it("does not remove sessions with the same id in different environment or workspace", () => {
    const ids = makeIds();
    const envBTarget: ViewTarget = {
      kind: "agentSession",
      environmentId: ENV_B,
      workspaceId: WS_A,
      agentSessionId: AGENT_X,
    };
    const wsBTarget: ViewTarget = {
      kind: "agentSession",
      environmentId: ENV_A,
      workspaceId: WS_B,
      agentSessionId: AGENT_X,
    };
    let snap = applyOpenTarget(emptyWorkbenchSnapshot(ids), envBTarget, ids);
    snap = applySplitFocused(snap, wsBTarget, "right", ids);

    const after = applyRemoveSessionViews(snap, agent(AGENT_X), ids);
    expect(after).toBe(snap);
    expect(getActiveTab(after).panes.size).toBe(2);
  });

  it("matches session even when custom definitionId is present on target", () => {
    const ids = makeIds();
    const customTarget: ViewTarget = {
      ...agent(AGENT_X),
      definitionId: "custom-agent-def",
    };
    let snap = applyOpenTarget(emptyWorkbenchSnapshot(ids), customTarget, ids);
    const after = applyRemoveSessionViews(snap, agent(AGENT_X), ids);
    expect(getActiveTab(after).panes.get(getActiveTab(after).focusedPaneId)?.target).toEqual({
      kind: "welcome",
    });
  });

  it("is idempotent and causes no side effects on repeated calls", () => {
    const ids = makeIds();
    let snap = applyOpenTarget(emptyWorkbenchSnapshot(ids), agent(AGENT_X), ids);
    snap = applyRemoveSessionViews(snap, agent(AGENT_X), ids);
    const repeat = applyRemoveSessionViews(snap, agent(AGENT_X), ids);
    expect(repeat).toBe(snap);
  });
});

describe("applyRemoveNewAgentSessionViews", () => {
  it("restores Welcome when the New Agent Session View is explicitly discarded", () => {
    const ids = makeIds();
    const target = newAgentSession();
    const opened = applyOpenTarget(emptyWorkbenchSnapshot(ids), target, ids);
    const after = applyRemoveNewAgentSessionViews(opened, target, ids);
    const tab = getActiveTab(after);
    expect(tab.panes.size).toBe(1);
    expect(tab.panes.get(tab.focusedPaneId)?.target).toEqual({ kind: "welcome" });
  });
});

describe("applyReplacePaneTarget", () => {
  it("promotes a New Agent Session View in place without changing its View instance", () => {
    const ids = makeIds();
    const draftTarget = newAgentSession();
    let snap = applyOpenTarget(emptyWorkbenchSnapshot(ids), draftTarget, ids);
    const paneId = getActiveTab(snap).focusedPaneId;
    const viewBefore = getActiveTab(snap).panes.get(paneId)!;

    snap = applyReplacePaneTarget(snap, paneId, agent(AGENT_X));

    const viewAfter = getActiveTab(snap).panes.get(paneId)!;
    expect(viewAfter.id).toBe(viewBefore.id);
    expect(viewAfter.target).toEqual(agent(AGENT_X));
  });
});

describe("applyPruneWorkspaceViews", () => {
  it("removes Views whose Workspace no longer exists", () => {
    const ids = makeIds();
    const draft = newAgentSession();
    const workspaceTarget: ViewTarget = {
      kind: "workspace",
      environmentId: ENV_A,
      workspaceId: WS_A,
    };
    let snap = applyOpenTarget(emptyWorkbenchSnapshot(ids), draft, ids);
    snap = applySplitFocused(snap, workspaceTarget, "right", ids);

    snap = applyPruneWorkspaceViews(snap, [], ids);

    const tab = getActiveTab(snap);
    expect(tab.panes.size).toBe(1);
    expect(tab.panes.get(tab.focusedPaneId)?.target.kind).toBe("welcome");
  });
});
