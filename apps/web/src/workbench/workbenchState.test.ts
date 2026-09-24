import { describe, expect, it } from "vite-plus/test";

import type { AwenProjectId, AgentSessionId, EnvironmentId, WorkspaceId } from "@awen/contracts";
import type { DraftId } from "../composerDraftStore";

import {
  getActiveTab,
  applyCreateTab,
  applyActivateTab,
  applyCloseTab,
  applyClosePane,
  applyDuplicateToNewTab,
  applyRenameTab,
  applyRemoveSessionViews,
  applyOpenTarget,
  applyOpenDeepLinkTarget,
  applySetFocused,
  applySetSplitRatio,
  applySetLayoutMode,
  applySplitFocused,
  applyRemoveNewAgentSessionViews,
  applyReplacePaneTarget,
  applyViewDrop,
  initialPaneDropTarget,
  applyPruneWorkspaceViews,
  emptyWorkbenchSnapshot,
  tabDisplayTitle,
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

  it("derives an automatic title from the first Pane and follows it when that Pane closes", () => {
    const ids = makeIds();
    let snap = applyOpenTarget(emptyWorkbenchSnapshot(ids), agent(AGENT_X), ids);
    snap = applySplitFocused(snap, terminal("term-1"), "right", ids);
    const firstPaneId = [...getActiveTab(snap).panes.entries()].find(
      ([, view]) => view.target.kind === "agentSession",
    )![0];
    const resolveTitle = (target: ViewTarget) =>
      target.kind === "agentSession" ? "Agent title" : "Terminal title";

    expect(tabDisplayTitle(getActiveTab(snap), resolveTitle)).toBe("Agent title");
    snap = applyClosePane(snap, firstPaneId, ids)!;
    expect(tabDisplayTitle(getActiveTab(snap), resolveTitle)).toBe("Terminal title");
  });

  it("keeps a manually renamed Tab title when its first Pane changes", () => {
    const ids = makeIds();
    let snap = emptyWorkbenchSnapshot(ids);
    const tabId = snap.activeTabId;
    snap = applyRenameTab(snap, tabId, "My workbench");
    snap = applyOpenTarget(snap, agent(AGENT_X), ids);

    expect(tabDisplayTitle(getActiveTab(snap), () => "Agent title")).toBe("My workbench");
    expect(getActiveTab(snap).titleMode).toBe("manual");
  });
});

describe("applyCloseTab", () => {
  it("removes one Tab without changing the same Session in another Tab", () => {
    const ids = makeIds();
    let snap = applyOpenTarget(emptyWorkbenchSnapshot(ids), agent(AGENT_X), ids);
    const firstTabId = snap.activeTabId;
    const firstPaneId = getActiveTab(snap).focusedPaneId;
    const duplicate = applyDuplicateToNewTab(
      snap,
      { kind: "pane", tabId: firstTabId, paneId: firstPaneId },
      1,
      ids,
    )!;
    snap = duplicate.snapshot;
    const secondTabId = duplicate.tabId;

    snap = applyCloseTab(snap, secondTabId);

    expect(snap.tabs).toHaveLength(1);
    expect(snap.activeTabId).toBe(firstTabId);
    expect([...getActiveTab(snap).panes.values()][0]?.target).toEqual(agent(AGENT_X));
  });

  it("keeps the final Tab as an explicit Welcome state", () => {
    const snap = emptyWorkbenchSnapshot(makeIds());
    expect(applyCloseTab(snap, snap.activeTabId)).toBe(snap);
  });
});

describe("applyOpenDeepLinkTarget", () => {
  it("focuses a target that is already open in another Tab", () => {
    const ids = makeIds();
    let snap = applyOpenTarget(emptyWorkbenchSnapshot(ids), agent(AGENT_X), ids);
    const firstTabId = snap.activeTabId;
    const firstPaneId = getActiveTab(snap).focusedPaneId;
    snap = applyCreateTab(snap, ids);
    snap = applyOpenTarget(snap, terminal("term-1"), ids);

    snap = applyOpenDeepLinkTarget(snap, agent(AGENT_X), ids);

    expect(snap.activeTabId).toBe(firstTabId);
    expect(getActiveTab(snap).focusedPaneId).toBe(firstPaneId);
    expect(snap.tabs).toHaveLength(2);
  });

  it("opens a missing deep-link target in a new Tab without replacing restored work", () => {
    const ids = makeIds();
    let snap = applyOpenTarget(emptyWorkbenchSnapshot(ids), agent(AGENT_X), ids);
    const firstTabId = snap.activeTabId;
    snap = applySplitFocused(snap, terminal("term-1"), "right", ids);
    const firstTabPaneIds = [...getActiveTab(snap).panes.keys()];

    snap = applyOpenDeepLinkTarget(snap, agent(AGENT_Y), ids);

    expect(snap.tabs).toHaveLength(2);
    expect(snap.tabs[0]?.id).toBe(firstTabId);
    expect([...snap.tabs[0]!.panes.keys()]).toEqual(firstTabPaneIds);
    expect([...getActiveTab(snap).panes.values()][0]?.target).toEqual(agent(AGENT_Y));
  });

  it("replaces a sole Welcome View instead of creating a redundant empty Tab", () => {
    const snap = applyOpenDeepLinkTarget(
      emptyWorkbenchSnapshot(makeIds()),
      agent(AGENT_X),
      makeIds(),
    );
    expect(snap.tabs).toHaveLength(1);
    expect([...getActiveTab(snap).panes.values()][0]?.target).toEqual(agent(AGENT_X));
  });

  it("focuses the Workspace's existing draft instead of creating a stray Welcome Tab", () => {
    const ids = makeIds();
    let snap = applyOpenTarget(emptyWorkbenchSnapshot(ids), newAgentSession(DRAFT_X), ids);
    const firstTabId = snap.activeTabId;
    const firstPaneId = getActiveTab(snap).focusedPaneId;
    snap = applyCreateTab(snap, ids);

    snap = applyOpenDeepLinkTarget(snap, newAgentSession(DRAFT_X), ids);

    expect(snap.tabs).toHaveLength(2);
    expect(snap.activeTabId).toBe(firstTabId);
    expect(getActiveTab(snap).focusedPaneId).toBe(firstPaneId);
    expect([...getActiveTab(snap).panes.values()][0]?.target).toEqual(newAgentSession(DRAFT_X));
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

  it("focuses the existing pane when the target is already open in the active Tab", () => {
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
    expect(snap.tabs).toHaveLength(1);
  });

  it("switches to the existing Tab and focuses the pane when the target is open in an inactive Tab", () => {
    const ids = makeIds();
    let snap = emptyWorkbenchSnapshot(ids);
    snap = applyOpenTarget(snap, agent(AGENT_X), ids);
    const tab1Id = snap.activeTabId;
    const tab1PaneId = getActiveTab(snap).focusedPaneId;

    snap = applyCreateTab(snap, ids);
    snap = applyOpenTarget(snap, terminal("term-1"), ids);
    expect(snap.activeTabId).not.toBe(tab1Id);

    snap = applyOpenTarget(snap, agent(AGENT_X), ids);
    expect(snap.activeTabId).toBe(tab1Id);
    expect(getActiveTab(snap).focusedPaneId).toBe(tab1PaneId);
    expect(snap.tabs).toHaveLength(2);
  });

  it("switches to the leftmost Tab when the target is present in multiple inactive Tabs", () => {
    const ids = makeIds();
    let snap = emptyWorkbenchSnapshot(ids);
    snap = applyOpenTarget(snap, agent(AGENT_X), ids);
    const tab1Id = snap.activeTabId;
    const tab1PaneId = getActiveTab(snap).focusedPaneId;

    snap = applyCreateTab(snap, ids);
    snap = applyOpenTarget(snap, terminal("term-1"), ids);

    snap = applyDuplicateToNewTab(
      snap,
      { kind: "pane", tabId: tab1Id, paneId: tab1PaneId },
      2,
      ids,
    )!.snapshot;
    const tab3Id = snap.activeTabId;

    snap = applyActivateTab(snap, snap.tabs[1]!.id);
    expect(snap.activeTabId).not.toBe(tab1Id);
    expect(snap.activeTabId).not.toBe(tab3Id);

    snap = applyOpenTarget(snap, agent(AGENT_X), ids);
    expect(snap.activeTabId).toBe(tab1Id);
    expect(getActiveTab(snap).focusedPaneId).toBe(tab1PaneId);
  });

  it("opens an unopened target in a new Tab next to the active Tab when active Tab has work", () => {
    const ids = makeIds();
    let snap = emptyWorkbenchSnapshot(ids);
    snap = applyOpenTarget(snap, agent(AGENT_X), ids);
    const tab1Id = snap.activeTabId;
    const tab1PaneId = getActiveTab(snap).focusedPaneId;

    snap = applyCreateTab(snap, ids);
    snap = applyOpenTarget(snap, terminal("term-1"), ids);
    const tab2Id = snap.activeTabId;

    snap = applyActivateTab(snap, tab1Id);

    snap = applyOpenTarget(snap, agent(AGENT_Y), ids);
    expect(snap.tabs).toHaveLength(3);
    expect(snap.tabs[0]?.id).toBe(tab1Id);
    expect(snap.tabs[1]?.id).toBe(snap.activeTabId);
    expect(snap.tabs[2]?.id).toBe(tab2Id);
    expect(getActiveTab(snap).panes.size).toBe(1);
    expect(getActiveTab(snap).panes.get(getActiveTab(snap).focusedPaneId)?.target).toEqual(
      agent(AGENT_Y),
    );
    expect(snap.tabs[0]!.panes.size).toBe(1);
    expect(snap.tabs[0]!.panes.get(tab1PaneId)?.target).toEqual(agent(AGENT_X));
  });

  it("replaces the active Tab in-place if it is an empty Welcome Tab among multiple Tabs", () => {
    const ids = makeIds();
    let snap = emptyWorkbenchSnapshot(ids);
    snap = applyOpenTarget(snap, agent(AGENT_X), ids);

    snap = applyCreateTab(snap, ids);
    const tab2Id = snap.activeTabId;
    expect(snap.tabs).toHaveLength(2);
    expect(getActiveTab(snap).panes.get(getActiveTab(snap).focusedPaneId)?.target.kind).toBe(
      "welcome",
    );

    snap = applyOpenTarget(snap, terminal("term-1"), ids);
    expect(snap.tabs).toHaveLength(2);
    expect(snap.activeTabId).toBe(tab2Id);
    expect(getActiveTab(snap).panes.size).toBe(1);
    expect(getActiveTab(snap).panes.get(getActiveTab(snap).focusedPaneId)?.target).toEqual(
      terminal("term-1"),
    );
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

  it("keeps at most one New Agent Session View for the same draft under ADR 0016", () => {
    const ids = makeIds();
    const firstDraft = newAgentSession(DRAFT_X);
    let snap = applyOpenTarget(emptyWorkbenchSnapshot(ids), firstDraft, ids);
    const firstPaneId = getActiveTab(snap).focusedPaneId;

    snap = applyOpenTarget(snap, firstDraft, ids);

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

  it("focuses the existing Workspace draft when splitting the same draft, but allows distinct drafts under ADR 0016", () => {
    const ids = makeIds();
    let snap = applyOpenTarget(emptyWorkbenchSnapshot(ids), newAgentSession(DRAFT_X), ids);
    const firstPaneId = getActiveTab(snap).focusedPaneId;
    snap = applySplitFocused(snap, newAgentSession(DRAFT_X), "right", ids);
    expect(getActiveTab(snap).panes.size).toBe(1);
    expect(getActiveTab(snap).focusedPaneId).toBe(firstPaneId);

    snap = applySplitFocused(snap, newAgentSession("draft-y" as DraftId), "right", ids);
    expect(getActiveTab(snap).panes.size).toBe(2);
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
  const duplicate = applyDuplicateToNewTab(
    snap,
    { kind: "pane", tabId: firstTab.id, paneId: firstTab.focusedPaneId },
    1,
    ids,
  )!;
  snap = duplicate.snapshot;
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
    projectId: "shared" as AwenProjectId,
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
    const agentXPaneId = getActiveTab(snap).focusedPaneId;
    snap = applySplitFocused(snap, terminal("term-1"), "right", ids);
    const tab1Id = snap.activeTabId;

    // Tab 2: Agent X + Agent Y
    const duplicate = applyDuplicateToNewTab(
      snap,
      { kind: "pane", tabId: tab1Id, paneId: agentXPaneId },
      1,
      ids,
    )!;
    snap = duplicate.snapshot;
    snap = applySplitFocused(snap, agent(AGENT_Y), "right", ids);
    const tab2Id = snap.activeTabId;

    // Tab 3: Agent Y + Terminal 1 (unrelated to Agent X)
    const agentYPaneId = getActiveTab(snap).focusedPaneId;
    const duplicate3 = applyDuplicateToNewTab(
      snap,
      { kind: "pane", tabId: tab2Id, paneId: agentYPaneId },
      2,
      ids,
    )!;
    snap = duplicate3.snapshot;
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

  it("focuses an existing Session instead of creating a duplicate during promotion", () => {
    const ids = makeIds();
    let snap = applyOpenTarget(emptyWorkbenchSnapshot(ids), agent(AGENT_X), ids);
    const agentPaneId = getActiveTab(snap).focusedPaneId;
    snap = applySplitFocused(snap, terminal("term-1"), "right", ids);
    const terminalPaneId = getActiveTab(snap).focusedPaneId;

    snap = applyReplacePaneTarget(snap, terminalPaneId, agent(AGENT_X));

    expect(getActiveTab(snap).panes.size).toBe(1);
    expect(getActiveTab(snap).focusedPaneId).toBe(agentPaneId);
    expect(getActiveTab(snap).panes.get(agentPaneId)?.target).toEqual(agent(AGENT_X));
  });
});

describe("applyViewDrop", () => {
  it("replaces the target Pane with a new View instance when Sidebar content is dropped in the center", () => {
    const ids = makeIds();
    let snap = applyOpenTarget(emptyWorkbenchSnapshot(ids), agent(AGENT_X), ids);
    const tab = getActiveTab(snap);
    const targetPaneId = tab.focusedPaneId;
    const previousView = tab.panes.get(targetPaneId)!;

    const result = applyViewDrop(
      snap,
      { kind: "sidebar", target: terminal("term-1") },
      { kind: "pane", tabId: tab.id, paneId: targetPaneId, zone: "replace" },
      ids,
    );

    expect(result).not.toBeNull();
    const dropped = getActiveTab(result!.snapshot);
    expect(dropped.id).toBe(tab.id);
    expect(dropped.panes.get(targetPaneId)?.target).toEqual(terminal("term-1"));
    expect(dropped.panes.get(targetPaneId)?.id).not.toBe(previousView.id);
    expect(result!.paneId).toBe(targetPaneId);
  });

  it("splits the target Pane on the requested edge when Sidebar content is dropped near an edge", () => {
    const ids = makeIds();
    const snap = applyOpenTarget(emptyWorkbenchSnapshot(ids), agent(AGENT_X), ids);
    const tab = getActiveTab(snap);
    const targetPaneId = tab.focusedPaneId;

    const result = applyViewDrop(
      snap,
      { kind: "sidebar", target: terminal("term-1") },
      { kind: "pane", tabId: tab.id, paneId: targetPaneId, zone: "right" },
      ids,
    );

    expect(result).not.toBeNull();
    const dropped = getActiveTab(result!.snapshot);
    expect(dropped.panes.size).toBe(2);
    expect(dropped.panes.get(targetPaneId)?.target).toEqual(agent(AGENT_X));
    expect(dropped.panes.get(result!.paneId)?.target).toEqual(terminal("term-1"));
    expect(leafIds(dropped.layout)).toEqual([targetPaneId, result!.paneId]);
    expect(dropped.focusedPaneId).toBe(result!.paneId);
  });

  it("focuses an existing Session View instead of creating a duplicate in the target Tab", () => {
    const ids = makeIds();
    let snap = applyOpenTarget(emptyWorkbenchSnapshot(ids), agent(AGENT_X), ids);
    const tab = getActiveTab(snap);
    const agentPaneId = tab.focusedPaneId;
    snap = applySplitFocused(snap, terminal("term-1"), "right", ids);
    const terminalPaneId = getActiveTab(snap).focusedPaneId;

    const result = applyViewDrop(
      snap,
      { kind: "sidebar", target: agent(AGENT_X) },
      { kind: "pane", tabId: tab.id, paneId: terminalPaneId, zone: "replace" },
      ids,
    );

    expect(result).not.toBeNull();
    expect(getActiveTab(result!.snapshot).focusedPaneId).toBe(agentPaneId);
    expect(getActiveTab(result!.snapshot).panes.size).toBe(2);
    expect(result).toMatchObject({ tabId: tab.id, paneId: agentPaneId });
  });

  it("opens Sidebar content into an existing Tab and focuses it there", () => {
    const ids = makeIds();
    let snap = applyOpenTarget(emptyWorkbenchSnapshot(ids), agent(AGENT_X), ids);
    snap = applyCreateTab(snap, ids);
    const targetTab = getActiveTab(snap);
    const welcomePaneId = targetTab.focusedPaneId;

    const result = applyViewDrop(
      snap,
      { kind: "sidebar", target: terminal("term-1") },
      { kind: "existingTab", tabId: targetTab.id },
      ids,
    );

    expect(result).not.toBeNull();
    const dropped = result!.snapshot.tabs.find((tab) => tab.id === targetTab.id)!;
    expect(dropped.panes.size).toBe(1);
    expect(dropped.panes.get(welcomePaneId)?.target).toEqual(terminal("term-1"));
    expect(result!.snapshot.activeTabId).toBe(targetTab.id);
    expect(dropped.focusedPaneId).toBe(welcomePaneId);
  });

  it("opens Sidebar content into a new Tab at the requested index", () => {
    const ids = makeIds();
    let snap = applyOpenTarget(emptyWorkbenchSnapshot(ids), agent(AGENT_X), ids);
    const firstTabId = snap.activeTabId;
    snap = applyCreateTab(snap, ids);
    const secondTabId = snap.activeTabId;

    const result = applyViewDrop(
      snap,
      { kind: "sidebar", target: terminal("term-1") },
      { kind: "newTab", index: 1 },
      ids,
    );

    expect(result).not.toBeNull();
    expect(result!.snapshot.tabs.map((tab) => tab.id)).toEqual([
      firstTabId,
      result!.tabId,
      secondTabId,
    ]);
    const newTab = result!.snapshot.tabs.find((tab) => tab.id === result!.tabId)!;
    expect(newTab.panes.get(result!.paneId)?.target).toEqual(terminal("term-1"));
    expect(result!.snapshot.activeTabId).toBe(result!.tabId);
  });

  it("moves a Pane View instance to another Pane edge without changing its identity", () => {
    const ids = makeIds();
    let snap = applyOpenTarget(emptyWorkbenchSnapshot(ids), agent(AGENT_X), ids);
    const tabId = snap.activeTabId;
    const sourcePaneId = getActiveTab(snap).focusedPaneId;
    const sourceView = getActiveTab(snap).panes.get(sourcePaneId)!;
    snap = applySplitFocused(snap, terminal("term-1"), "right", ids);
    const targetPaneId = getActiveTab(snap).focusedPaneId;

    const result = applyViewDrop(
      snap,
      { kind: "pane", tabId, paneId: sourcePaneId },
      { kind: "pane", tabId, paneId: targetPaneId, zone: "right" },
      ids,
    );

    expect(result).not.toBeNull();
    const dropped = getActiveTab(result!.snapshot);
    expect(leafIds(dropped.layout)).toEqual([targetPaneId, sourcePaneId]);
    expect(dropped.panes.get(sourcePaneId)).toBe(sourceView);
    expect(dropped.focusedPaneId).toBe(sourcePaneId);
    expect(result).toMatchObject({ tabId, paneId: sourcePaneId });
  });

  it("repositions a Pane when dropped with directional edge within the same Tab in BSP mode", () => {
    const ids = makeIds();
    let snap = applyOpenTarget(emptyWorkbenchSnapshot(ids), agent(AGENT_X), ids);
    const tabId = snap.activeTabId;
    const sourcePaneId = getActiveTab(snap).focusedPaneId;
    const sourceView = getActiveTab(snap).panes.get(sourcePaneId)!;
    snap = applySplitFocused(snap, terminal("term-1"), "right", ids);
    const targetPaneId = getActiveTab(snap).focusedPaneId;
    const targetView = getActiveTab(snap).panes.get(targetPaneId)!;

    const result = applyViewDrop(
      snap,
      { kind: "pane", tabId, paneId: sourcePaneId },
      { kind: "pane", tabId, paneId: targetPaneId, zone: "right" },
      ids,
    );

    expect(result).not.toBeNull();
    const dropped = getActiveTab(result!.snapshot);
    expect(leafIds(dropped.layout)).toEqual([targetPaneId, sourcePaneId]);
    expect(dropped.panes.get(sourcePaneId)).toBe(sourceView);
    expect(dropped.panes.get(targetPaneId)).toBe(targetView);
    expect(dropped.focusedPaneId).toBe(sourcePaneId);
    expect(result).toMatchObject({ tabId, paneId: sourcePaneId });
  });

  it("repositions a Pane when dropped with directional edge within the same Tab in scrolling mode", () => {
    const ids = makeIds();
    let snap = applyOpenTarget(emptyWorkbenchSnapshot(ids), agent(AGENT_X), ids);
    const tabId = snap.activeTabId;
    const sourcePaneId = getActiveTab(snap).focusedPaneId;
    const sourceView = getActiveTab(snap).panes.get(sourcePaneId)!;
    snap = applySplitFocused(snap, terminal("term-1"), "right", ids);
    const targetPaneId = getActiveTab(snap).focusedPaneId;
    const targetView = getActiveTab(snap).panes.get(targetPaneId)!;
    snap = applySetLayoutMode(snap, "scrolling");

    const result = applyViewDrop(
      snap,
      { kind: "pane", tabId, paneId: sourcePaneId },
      { kind: "pane", tabId, paneId: targetPaneId, zone: "right" },
      ids,
    );

    expect(result).not.toBeNull();
    const dropped = getActiveTab(result!.snapshot);
    expect(dropped.columns?.map((c) => c.paneIds)).toEqual([[targetPaneId], [sourcePaneId]]);
    expect(dropped.panes.get(sourcePaneId)).toBe(sourceView);
    expect(dropped.panes.get(targetPaneId)).toBe(targetView);
    expect(dropped.focusedPaneId).toBe(sourcePaneId);
    expect(result).toMatchObject({ tabId, paneId: sourcePaneId });
  });

  it("moves a Pane View instance into an existing Tab and leaves Welcome behind", () => {
    const ids = makeIds();
    let snap = applyOpenTarget(emptyWorkbenchSnapshot(ids), agent(AGENT_X), ids);
    const sourceTabId = snap.activeTabId;
    const sourcePaneId = getActiveTab(snap).focusedPaneId;
    const sourceView = getActiveTab(snap).panes.get(sourcePaneId)!;
    snap = applyCreateTab(snap, ids);
    const targetTabId = snap.activeTabId;
    snap = applyOpenTarget(snap, terminal("term-1"), ids);
    const targetPaneId = getActiveTab(snap).focusedPaneId;

    const result = applyViewDrop(
      snap,
      { kind: "pane", tabId: sourceTabId, paneId: sourcePaneId },
      { kind: "existingTab", tabId: targetTabId },
      ids,
    );

    expect(result).not.toBeNull();
    const sourceTab = result!.snapshot.tabs.find((tab) => tab.id === sourceTabId)!;
    const targetTab = result!.snapshot.tabs.find((tab) => tab.id === targetTabId)!;
    expect(sourceTab.panes.size).toBe(1);
    expect(sourceTab.panes.get(sourceTab.focusedPaneId)?.target).toEqual({ kind: "welcome" });
    expect(targetTab.panes.get(targetPaneId)?.target).toEqual(terminal("term-1"));
    expect(targetTab.panes.get(sourcePaneId)).toBe(sourceView);
    expect(leafIds(targetTab.layout)).toEqual([targetPaneId, sourcePaneId]);
    expect(result!.snapshot.activeTabId).toBe(targetTabId);
    expect(targetTab.focusedPaneId).toBe(sourcePaneId);
  });

  it("refuses to move a View into a Tab that already has the same Session", () => {
    const ids = makeIds();
    let snap = applyOpenTarget(emptyWorkbenchSnapshot(ids), agent(AGENT_X), ids);
    const sourceTabId = snap.activeTabId;
    const sourcePaneId = getActiveTab(snap).focusedPaneId;
    const duplicate = applyDuplicateToNewTab(
      snap,
      { kind: "pane", tabId: sourceTabId, paneId: sourcePaneId },
      1,
      ids,
    )!;
    snap = duplicate.snapshot;
    const targetTabId = duplicate.tabId;

    const result = applyViewDrop(
      snap,
      { kind: "pane", tabId: sourceTabId, paneId: sourcePaneId },
      { kind: "existingTab", tabId: targetTabId },
      ids,
    );

    expect(result).toBeNull();
  });

  it("moves a Pane View instance into a new Tab at the requested index", () => {
    const ids = makeIds();
    let snap = applyOpenTarget(emptyWorkbenchSnapshot(ids), agent(AGENT_X), ids);
    const sourceTabId = snap.activeTabId;
    const sourcePaneId = getActiveTab(snap).focusedPaneId;
    const sourceView = getActiveTab(snap).panes.get(sourcePaneId)!;
    snap = applyCreateTab(snap, ids);
    const secondTabId = snap.activeTabId;
    snap = applyOpenTarget(snap, terminal("term-1"), ids);

    const result = applyViewDrop(
      snap,
      { kind: "pane", tabId: sourceTabId, paneId: sourcePaneId },
      { kind: "newTab", index: 1 },
      ids,
    );

    expect(result).not.toBeNull();
    expect(result!.snapshot.tabs.map((tab) => tab.id)).toEqual([
      sourceTabId,
      result!.tabId,
      secondTabId,
    ]);
    const sourceTab = result!.snapshot.tabs.find((tab) => tab.id === sourceTabId)!;
    const newTab = result!.snapshot.tabs.find((tab) => tab.id === result!.tabId)!;
    expect(sourceTab.panes.get(sourceTab.focusedPaneId)?.target).toEqual({ kind: "welcome" });
    expect(newTab.panes.get(result!.paneId)).toBe(sourceView);
    expect(result!.paneId).toBe(sourcePaneId);
    expect(result!.snapshot.activeTabId).toBe(result!.tabId);
  });

  describe("tab source canvas docking into pane target (ADR-0017)", () => {
    it("splits target Pane and removes source Tab when inactive single-pane Tab is dropped onto active Tab pane", () => {
      const ids = makeIds();
      let snap = applyOpenTarget(emptyWorkbenchSnapshot(ids), agent(AGENT_X), ids);
      const activeTabId = snap.activeTabId;
      const activeTabPaneId = getActiveTab(snap).focusedPaneId;

      // Create a second tab and open a terminal in it
      snap = applyCreateTab(snap, ids);
      snap = applyOpenTarget(snap, terminal("term-1"), ids);
      const inactiveTabId = snap.activeTabId;
      const inactiveTab = snap.tabs.find((t) => t.id === inactiveTabId)!;
      const inactivePaneId = inactiveTab.focusedPaneId;
      const inactiveView = inactiveTab.panes.get(inactivePaneId)!;

      // Switch active tab back to Tab 1
      snap = { ...snap, activeTabId };

      const result = applyViewDrop(
        snap,
        { kind: "tab", tabId: inactiveTabId },
        { kind: "pane", tabId: activeTabId, paneId: activeTabPaneId, zone: "right" },
        ids,
      );

      expect(result).not.toBeNull();
      // Source tab must be closed and removed
      expect(result!.snapshot.tabs.find((t) => t.id === inactiveTabId)).toBeUndefined();
      expect(result!.snapshot.tabs.length).toBe(1);
      expect(result!.snapshot.activeTabId).toBe(activeTabId);

      const targetTab = result!.snapshot.tabs.find((t) => t.id === activeTabId)!;
      expect(targetTab.panes.size).toBe(2);
      expect(targetTab.panes.get(activeTabPaneId)?.target).toEqual(agent(AGENT_X));
      expect(targetTab.panes.get(inactivePaneId)).toBe(inactiveView);
      expect(targetTab.focusedPaneId).toBe(inactivePaneId);
      expect(result!.tabId).toBe(activeTabId);
      expect(result!.paneId).toBe(inactivePaneId);
    });

    it("absorbs and replaces Welcome View when inactive single-pane Tab is dropped into an empty active Tab", () => {
      const ids = makeIds();
      // Tab 1 is an empty tab (welcome view)
      let snap = emptyWorkbenchSnapshot(ids);
      const emptyTabId = snap.activeTabId;

      // Tab 2 has a terminal session
      snap = applyCreateTab(snap, ids);
      snap = applyOpenTarget(snap, terminal("term-1"), ids);
      const terminalTabId = snap.activeTabId;
      const terminalPaneId = snap.tabs.find((t) => t.id === terminalTabId)!.focusedPaneId;
      const terminalView = snap.tabs.find((t) => t.id === terminalTabId)!.panes.get(terminalPaneId)!;

      // Switch active tab back to empty Tab 1
      snap = { ...snap, activeTabId: emptyTabId };
      const emptyPaneId = snap.tabs.find((t) => t.id === emptyTabId)!.focusedPaneId;

      const result = applyViewDrop(
        snap,
        { kind: "tab", tabId: terminalTabId },
        { kind: "pane", tabId: emptyTabId, paneId: emptyPaneId, zone: "right" },
        ids,
      );

      expect(result).not.toBeNull();
      expect(result!.snapshot.tabs.find((t) => t.id === terminalTabId)).toBeUndefined();
      expect(result!.snapshot.tabs.length).toBe(1);
      const targetTab = result!.snapshot.tabs[0]!;
      expect(targetTab.panes.size).toBe(1);
      expect(targetTab.panes.get(terminalPaneId)).toBe(terminalView);
      expect(targetTab.focusedPaneId).toBe(terminalPaneId);
    });

    it("splits target Pane into a new Column when inactive single-pane Tab is dropped in Scrolling mode", () => {
      const ids = makeIds();
      let snap = applyOpenTarget(emptyWorkbenchSnapshot(ids), agent(AGENT_X), ids);
      snap = applySetLayoutMode(snap, "scrolling");
      const activeTabId = snap.activeTabId;
      const activeTabPaneId = getActiveTab(snap).focusedPaneId;

      snap = applyCreateTab(snap, ids);
      snap = applyOpenTarget(snap, terminal("term-1"), ids);
      const inactiveTabId = snap.activeTabId;
      const inactivePaneId = snap.tabs.find((t) => t.id === inactiveTabId)!.focusedPaneId;
      const inactiveView = snap.tabs.find((t) => t.id === inactiveTabId)!.panes.get(inactivePaneId)!;

      snap = { ...snap, activeTabId };

      const result = applyViewDrop(
        snap,
        { kind: "tab", tabId: inactiveTabId },
        { kind: "pane", tabId: activeTabId, paneId: activeTabPaneId, zone: "right" },
        ids,
      );

      expect(result).not.toBeNull();
      expect(result!.snapshot.tabs.find((t) => t.id === inactiveTabId)).toBeUndefined();
      const targetTab = result!.snapshot.tabs.find((t) => t.id === activeTabId)!;
      expect(targetTab.columns?.length).toBe(2);
      expect(targetTab.columns?.map((c) => c.paneIds)).toEqual([[activeTabPaneId], [inactivePaneId]]);
      expect(targetTab.panes.get(inactivePaneId)).toBe(inactiveView);
    });

    it("rejects canvas drop if target zone is central replace on an active Tab with existing content", () => {
      const ids = makeIds();
      let snap = applyOpenTarget(emptyWorkbenchSnapshot(ids), agent(AGENT_X), ids);
      const activeTabId = snap.activeTabId;
      const activePaneId = getActiveTab(snap).focusedPaneId;

      snap = applyCreateTab(snap, ids);
      snap = applyOpenTarget(snap, terminal("term-1"), ids);
      const inactiveTabId = snap.activeTabId;

      snap = { ...snap, activeTabId };

      const result = applyViewDrop(
        snap,
        { kind: "tab", tabId: inactiveTabId },
        { kind: "pane", tabId: activeTabId, paneId: activePaneId, zone: "replace" },
        ids,
      );

      expect(result).toBeNull();
    });

    it("rejects canvas drop if source Tab contains multiple panes", () => {
      const ids = makeIds();
      let snap = applyOpenTarget(emptyWorkbenchSnapshot(ids), agent(AGENT_X), ids);
      const activeTabId = snap.activeTabId;
      const activePaneId = getActiveTab(snap).focusedPaneId;

      // Tab 2 with 2 panes
      snap = applyCreateTab(snap, ids);
      snap = applyOpenTarget(snap, terminal("term-1"), ids);
      snap = applySplitFocused(snap, terminal("term-2"), "right", ids);
      const multiPaneTabId = snap.activeTabId;

      snap = { ...snap, activeTabId };

      const result = applyViewDrop(
        snap,
        { kind: "tab", tabId: multiPaneTabId },
        { kind: "pane", tabId: activeTabId, paneId: activePaneId, zone: "right" },
        ids,
      );

      expect(result).toBeNull();
    });

    it("rejects canvas drop if source Tab is the active Tab itself", () => {
      const ids = makeIds();
      let snap = applyOpenTarget(emptyWorkbenchSnapshot(ids), agent(AGENT_X), ids);
      const activeTabId = snap.activeTabId;
      const activePaneId = getActiveTab(snap).focusedPaneId;

      const result = applyViewDrop(
        snap,
        { kind: "tab", tabId: activeTabId },
        { kind: "pane", tabId: activeTabId, paneId: activePaneId, zone: "right" },
        ids,
      );

      expect(result).toBeNull();
    });

    it("rejects canvas drop if target Tab already contains the same session view", () => {
      const ids = makeIds();
      let snap = applyOpenTarget(emptyWorkbenchSnapshot(ids), agent(AGENT_X), ids);
      const activeTabId = snap.activeTabId;
      const activePaneId = getActiveTab(snap).focusedPaneId;

      // Tab 2 also contains agent(AGENT_X)
      snap = applyCreateTab(snap, ids);
      snap = applyOpenTarget(snap, agent(AGENT_X), ids);
      const duplicateTabId = snap.activeTabId;

      snap = { ...snap, activeTabId };

      const result = applyViewDrop(
        snap,
        { kind: "tab", tabId: duplicateTabId },
        { kind: "pane", tabId: activeTabId, paneId: activePaneId, zone: "right" },
        ids,
      );

      expect(result).toBeNull();
    });
  });
});

describe("applyDuplicateToNewTab", () => {
  it("duplicates a Session View into a new Tab without changing the source", () => {
    const ids = makeIds();
    let snap = applyOpenTarget(emptyWorkbenchSnapshot(ids), agent(AGENT_X), ids);
    snap = applyCreateTab(snap, ids);
    snap = applyOpenTarget(snap, terminal("term-1"), ids);
    const sourceTab = snap.tabs[0]!;
    const sourcePaneId = sourceTab.focusedPaneId;
    const sourceView = sourceTab.panes.get(sourcePaneId)!;
    const sourceBefore = sourceTab;

    const result = applyDuplicateToNewTab(
      snap,
      { kind: "pane", tabId: sourceTab.id, paneId: sourcePaneId },
      1,
      ids,
    );

    expect(result).not.toBeNull();
    expect(result!.snapshot.tabs[0]).toBe(sourceBefore);
    expect(result!.snapshot.tabs).toHaveLength(3);
    const duplicateTab = result!.snapshot.tabs[1]!;
    expect(duplicateTab.id).toBe(result!.tabId);
    expect(duplicateTab.panes.size).toBe(1);
    const duplicateView = duplicateTab.panes.get(result!.paneId)!;
    expect(duplicateView.id).not.toBe(sourceView.id);
    expect(duplicateView.target).toEqual(sourceView.target);
    expect(result!.snapshot.activeTabId).toBe(duplicateTab.id);
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

    snap = applyPruneWorkspaceViews(snap, [], ids, [ENV_A]);

    const tab = getActiveTab(snap);
    expect(tab.panes.size).toBe(1);
    expect(tab.panes.get(tab.focusedPaneId)?.target.kind).toBe("welcome");
  });

  it("keeps Views when their Environment is temporarily unavailable", () => {
    const ids = makeIds();
    const remoteTarget: ViewTarget = {
      ...newAgentSession(),
      environmentId: ENV_B,
    };
    const snap = applyOpenTarget(emptyWorkbenchSnapshot(ids), remoteTarget, ids);

    const after = applyPruneWorkspaceViews(snap, [], ids, [ENV_A]);

    expect(after).toBe(snap);
    expect([...getActiveTab(after).panes.values()][0]?.target).toEqual(remoteTarget);
  });
});

describe("initialPaneDropTarget", () => {
  const ids = makeIds();

  it("identifies the initial left/right drop target in a horizontal split", () => {
    let snap = applyOpenTarget(emptyWorkbenchSnapshot(ids), agent(AGENT_X), ids);
    const leftPaneId = getActiveTab(snap).focusedPaneId;
    snap = applySplitFocused(snap, terminal("term-1"), "right", ids);
    const rightPaneId = getActiveTab(snap).focusedPaneId;
    const tab = getActiveTab(snap);

    const targetLeft = initialPaneDropTarget(tab, leftPaneId);
    expect(targetLeft).toEqual({
      kind: "pane",
      tabId: tab.id,
      paneId: rightPaneId,
      zone: "left",
    });

    const targetRight = initialPaneDropTarget(tab, rightPaneId);
    expect(targetRight).toEqual({
      kind: "pane",
      tabId: tab.id,
      paneId: leftPaneId,
      zone: "right",
    });
  });

  it("identifies the initial top/bottom drop target in a vertical split", () => {
    let snap = applyOpenTarget(emptyWorkbenchSnapshot(ids), agent(AGENT_X), ids);
    const topPaneId = getActiveTab(snap).focusedPaneId;
    snap = applySplitFocused(snap, terminal("term-1"), "down", ids);
    const bottomPaneId = getActiveTab(snap).focusedPaneId;
    const tab = getActiveTab(snap);

    const targetTop = initialPaneDropTarget(tab, topPaneId);
    expect(targetTop).toEqual({
      kind: "pane",
      tabId: tab.id,
      paneId: bottomPaneId,
      zone: "top",
    });

    const targetBottom = initialPaneDropTarget(tab, bottomPaneId);
    expect(targetBottom).toEqual({
      kind: "pane",
      tabId: tab.id,
      paneId: topPaneId,
      zone: "bottom",
    });
  });

  it("identifies initial drop target in scrolling columns", () => {
    let snap = applyOpenTarget(emptyWorkbenchSnapshot(ids), agent(AGENT_X), ids);
    const firstPaneId = getActiveTab(snap).focusedPaneId;
    snap = applySplitFocused(snap, terminal("term-1"), "right", ids);
    const secondPaneId = getActiveTab(snap).focusedPaneId;
    snap = applySetLayoutMode(snap, "scrolling");
    const tab = getActiveTab(snap);

    expect(initialPaneDropTarget(tab, firstPaneId)).toEqual({
      kind: "pane",
      tabId: tab.id,
      paneId: secondPaneId,
      zone: "left",
    });
  });

  it("returns null when the tab has only one pane", () => {
    const snap = applyOpenTarget(emptyWorkbenchSnapshot(ids), agent(AGENT_X), ids);
    const tab = getActiveTab(snap);
    expect(initialPaneDropTarget(tab, tab.focusedPaneId)).toBeNull();
  });
});
