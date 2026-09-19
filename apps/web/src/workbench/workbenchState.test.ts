import { describe, expect, it } from "vite-plus/test";

import type {
  AgentSessionId,
  EnvironmentId,
  WorkspaceId,
} from "@t3tools/contracts";

import {
  applyClosePane,
  applyOpenTarget,
  applySetFocused,
  applySetSplitRatio,
  applySplitFocused,
  emptyWorkbenchSnapshot,
  type WorkbenchSnapshot,
} from "./workbenchState";
import { leafIds } from "./layout";
import type { ViewTarget } from "./viewRegistry";

const ENV_A: EnvironmentId = "env-a" as EnvironmentId;
const ENV_B: EnvironmentId = "env-b" as EnvironmentId;
const WS_A: WorkspaceId = "ws-a" as WorkspaceId;
const WS_B: WorkspaceId = "ws-b" as WorkspaceId;
const AGENT_X: AgentSessionId = "agent-x" as AgentSessionId;
const AGENT_Y: AgentSessionId = "agent-y" as AgentSessionId;

function agent(id: AgentSessionId, workspaceId: WorkspaceId = WS_A): Extract<ViewTarget, { kind: "agentSession" }> {
  return {
    kind: "agentSession",
    environmentId: ENV_A,
    workspaceId,
    agentSessionId: id,
  };
}

function terminal(id: string, workspaceId: WorkspaceId = WS_A): Extract<ViewTarget, { kind: "workspaceTerminal" }> {
  return {
    kind: "workspaceTerminal",
    environmentId: ENV_A,
    workspaceId,
    terminalId: id,
  };
}

/** Deterministic id generator for tests. */
function makeIds(): () => string {
  let n = 0;
  return () => `id-${++n}`;
}

describe("emptyWorkbenchSnapshot", () => {
  it("starts with a single empty pane focused", () => {
    const ids = makeIds();
    const snap = emptyWorkbenchSnapshot(ids);
    expect(snap.tab.layout.type).toBe("leaf");
    expect(snap.tab.focusedPaneId).toBe("id-1");
    expect(snap.panes.size).toBe(0);
  });
});

describe("applyOpenTarget", () => {
  it("creates a single pane carrying the target on an empty workbench", () => {
    const ids = makeIds();
    const before = emptyWorkbenchSnapshot(ids);
    const after = applyOpenTarget(before, agent(AGENT_X), ids);
    expect(after.panes.size).toBe(1);
    expect(after.panes.get(after.tab.focusedPaneId)).toEqual(agent(AGENT_X));
  });

  it("replaces the focused pane's target when no pane shares the target", () => {
    const ids = makeIds();
    let snap = emptyWorkbenchSnapshot(ids);
    snap = applyOpenTarget(snap, agent(AGENT_X), ids);
    const focusBefore = snap.tab.focusedPaneId;
    snap = applyOpenTarget(snap, terminal("term-1"), ids);
    expect(snap.panes.size).toBe(1);
    expect(snap.panes.get(focusBefore)).toEqual(terminal("term-1"));
    expect(snap.tab.focusedPaneId).toBe(focusBefore);
  });

  it("focuses the existing pane when the target is already open", () => {
    const ids = makeIds();
    let snap = emptyWorkbenchSnapshot(ids);
    snap = applyOpenTarget(snap, agent(AGENT_X), ids);
    const firstFocus = snap.tab.focusedPaneId;
    snap = applySplitFocused(snap, terminal("term-1"), "right", ids);
    const secondPaneId = findOtherLeaf(snap, firstFocus);
    snap = applySetFocused(snap, secondPaneId);
    snap = applyOpenTarget(snap, agent(AGENT_X), ids);
    expect(snap.tab.focusedPaneId).toBe(firstFocus);
    expect(snap.panes.size).toBe(2);
  });
});

describe("applySplitFocused", () => {
  it("creates a new pane adjacent to the focused one", () => {
    const ids = makeIds();
    let snap = emptyWorkbenchSnapshot(ids);
    snap = applyOpenTarget(snap, agent(AGENT_X), ids);
    const focusBefore = snap.tab.focusedPaneId;
    snap = applySplitFocused(snap, terminal("term-1"), "right", ids);
    expect(snap.panes.size).toBe(2);
    expect(snap.panes.get(focusBefore)).toEqual(agent(AGENT_X));
    const newFocus = findOtherLeaf(snap, focusBefore);
    expect(snap.panes.get(newFocus)).toEqual(terminal("term-1"));
    expect(snap.tab.focusedPaneId).toBe(newFocus);
  });

  it("honors the requested split direction", () => {
    const ids = makeIds();
    let snap = emptyWorkbenchSnapshot(ids);
    snap = applyOpenTarget(snap, agent(AGENT_X), ids);
    snap = applySplitFocused(snap, terminal("term-1"), "down", ids);
    expect(snap.tab.layout.type).toBe("split");
    if (snap.tab.layout.type !== "split") throw new Error("expected split");
    expect(snap.tab.layout.dir).toBe("down");
  });
});

describe("applyClosePane", () => {
  it("removes the pane from both the layout and the pane map", () => {
    const ids = makeIds();
    let snap = emptyWorkbenchSnapshot(ids);
    snap = applyOpenTarget(snap, agent(AGENT_X), ids);
    snap = applySplitFocused(snap, terminal("term-1"), "right", ids);
    const terminalPaneId = snap.tab.focusedPaneId;
    const next = applyClosePane(snap, terminalPaneId, ids);
    expect(next).not.toBeNull();
    if (next === null) return;
    snap = next;
    expect(snap.panes.size).toBe(1);
    expect(snap.panes.has(terminalPaneId)).toBe(false);
    expect(snap.tab.focusedPaneId).not.toBe(terminalPaneId);
  });

  it("resets to a fresh empty workbench when the last pane closes", () => {
    const ids = makeIds();
    let snap = emptyWorkbenchSnapshot(ids);
    snap = applyOpenTarget(snap, agent(AGENT_X), ids);
    const onlyPane = snap.tab.focusedPaneId;
    const reset = applyClosePane(snap, onlyPane, ids);
    expect(reset).not.toBeNull();
    if (reset === null) return;
    snap = reset;
    expect(snap.panes.size).toBe(0);
    expect(snap.tab.layout.type).toBe("leaf");
    // The new empty workbench should not retain the closed Session — opening
    // the same target again creates a fresh pane.
    snap = applyOpenTarget(snap, agent(AGENT_X), ids);
    expect(snap.panes.size).toBe(1);
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
    const first = findOtherLeaf(snap, snap.tab.focusedPaneId);
    snap = applySetFocused(snap, first);
    expect(snap.tab.focusedPaneId).toBe(first);
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
    const splitId = snap.tab.layout.type === "split" ? snap.tab.layout.id : null;
    expect(splitId).not.toBeNull();
    if (splitId === null) throw new Error("expected split");
    snap = applySetSplitRatio(snap, splitId, 0, 0.7);
    expect(snap.tab.layout.type).toBe("split");
    if (snap.tab.layout.type !== "split") throw new Error("expected split");
    expect(snap.tab.layout.sizes[0]).toBeCloseTo(0.7);
    expect(snap.tab.layout.sizes[1]).toBeCloseTo(0.3);
  });
});

describe("isolation between panes", () => {
  it("opening the same Agent target in two Pane leaves shows the same target", () => {
    const ids = makeIds();
    let snap = emptyWorkbenchSnapshot(ids);
    snap = applyOpenTarget(snap, agent(AGENT_X), ids);
    const first = snap.tab.focusedPaneId;
    snap = applySplitFocused(snap, agent(AGENT_X), "right", ids);
    const second = findOtherLeaf(snap, first);
    // Both panes reference the same agent target — the View layer is
    // responsible for not double-subscribing to runtime events.
    expect(snap.panes.get(first)).toEqual(agent(AGENT_X));
    expect(snap.panes.get(second)).toEqual(agent(AGENT_X));
    expect(snap.panes.get(first)).not.toBe(snap.panes.get(second));
  });

  it("keeps each pane's target intact across focus changes", () => {
    const ids = makeIds();
    let snap = emptyWorkbenchSnapshot(ids);
    snap = applyOpenTarget(snap, agent(AGENT_X), ids);
    const first = snap.tab.focusedPaneId;
    snap = applySplitFocused(snap, terminal("term-1"), "right", ids);
    const second = findOtherLeaf(snap, first);
    snap = applySetFocused(snap, first);
    expect(snap.panes.get(first)).toEqual(agent(AGENT_X));
    expect(snap.panes.get(second)).toEqual(terminal("term-1"));
  });
});

function findOtherLeaf(snap: WorkbenchSnapshot, paneId: string): string {
  const ids = leafIds(snap.tab.layout);
  const other = ids.find((id) => id !== paneId);
  if (!other) throw new Error("expected at least one other leaf");
  return other;
}