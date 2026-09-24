const showContextMenuMock = vi
  .fn<(items: unknown, position?: { x: number; y: number }) => Promise<unknown>>()
  .mockResolvedValue(null);

vi.mock("../../localApi", () => ({
  readLocalApi: () => ({
    dialogs: { confirm: vi.fn().mockResolvedValue(true) },
    contextMenu: { show: showContextMenuMock, close: vi.fn() },
    shell: { openExternal: vi.fn() },
    persistence: { getClientSettings: vi.fn(), setClientSettings: vi.fn() },
  }),
  ensureLocalApi: () => ({
    dialogs: { confirm: vi.fn().mockResolvedValue(true) },
    contextMenu: { show: showContextMenuMock, close: vi.fn() },
    shell: { openExternal: vi.fn() },
    persistence: { getClientSettings: vi.fn(), setClientSettings: vi.fn() },
  }),
}));
import { act } from "react";
import { create, type ReactTestRenderer } from "react-test-renderer";
import { afterEach, expect, it, vi } from "vite-plus/test";
import type { AgentSessionId, EnvironmentId, WorkspaceId } from "@awen/contracts";
import { SessionRow } from "./SessionRow";
import { resetWorkbenchStore, useWorkbenchStore } from "../../workbench/workbenchStore";
import { getActiveTab } from "../../workbench/workbenchState";

let renderer: ReactTestRenderer;
afterEach(async () => {
  await act(() => renderer?.unmount());
  resetWorkbenchStore();
  vi.unstubAllGlobals();
});
it("opens, splits and focuses Agent Sessions by Awen identity, including reopening a closed View", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const target = {
    kind: "agentSession",
    environmentId: "local" as EnvironmentId,
    workspaceId: "workspace" as WorkspaceId,
    agentSessionId: "one" as AgentSessionId,
  } as const;
  const navigate = vi.fn();
  await act(() => {
    renderer = create(
      <>
        <SessionRow navigateTo={navigate} target={target}>
          First
        </SessionRow>
        <SessionRow
          navigateTo={navigate}
          target={{ ...target, agentSessionId: "two" as AgentSessionId }}
        >
          Second
        </SessionRow>
      </>,
    );
  });
  const [first, second] = renderer!.root.findAllByType("button");
  await act(() => first!.props.onClick({ altKey: false }));
  expect(getActiveTab(useWorkbenchStore.getState()).panes.size).toBe(1);
  expect([...getActiveTab(useWorkbenchStore.getState()).panes.values()][0]?.target).toEqual(target);
  expect(navigate).toHaveBeenCalledTimes(1);
  await act(() => first!.props.onClick({ altKey: false }));
  expect(navigate).toHaveBeenCalledTimes(2);
  expect(navigate).toHaveBeenCalledWith(
    expect.objectContaining({
      to: "/$environmentId/workspaces/$workspaceId/agent-sessions/$agentSessionId",
      params: expect.objectContaining({ agentSessionId: "one" }),
      replace: true,
    }),
  );
  await act(() => second!.props.onClick({ altKey: true, shiftKey: false }));
  expect(getActiveTab(useWorkbenchStore.getState()).layout).toMatchObject({
    type: "split",
    dir: "right",
  });
  await act(() => first!.props.onClick({ altKey: true }));
  const tab = getActiveTab(useWorkbenchStore.getState());
  expect(tab.panes.size).toBe(2);
  expect(tab.panes.get(tab.focusedPaneId)?.target).toEqual(target);
  await act(() => useWorkbenchStore.getState().closeView(tab.focusedPaneId));
  await act(() => first!.props.onClick({ altKey: false }));
  const reopened = getActiveTab(useWorkbenchStore.getState());
  expect(reopened.panes.get(reopened.focusedPaneId)?.target).toEqual(target);
});

it("mixes Agent and Terminal Views, splits down and reopens the same Terminal Session once per Tab", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const { terminalTargetForRuntime } = await import("../../workbench/sessionTarget");
  const target = terminalTargetForRuntime({
    environmentId: "local" as EnvironmentId,
    workspaceId: "workspace" as WorkspaceId,
    terminalId: "shell",
  });
  useWorkbenchStore.getState().openTarget({
    kind: "agentSession",
    environmentId: target.environmentId,
    workspaceId: target.workspaceId,
    agentSessionId: "agent" as AgentSessionId,
  });
  await act(() => {
    renderer = create(<SessionRow target={target}>Shell</SessionRow>);
  });
  const row = renderer!.root.findByType("button");
  await act(() => row.props.onClick({ altKey: true, shiftKey: true }));
  let tab = getActiveTab(useWorkbenchStore.getState());
  expect(tab.layout).toMatchObject({ type: "split", dir: "down" });
  expect([...tab.panes.values()].map((view) => view.target.kind)).toEqual([
    "agentSession",
    "workspaceTerminal",
  ]);
  await act(() => row.props.onClick({ altKey: true }));
  expect(getActiveTab(useWorkbenchStore.getState()).panes.size).toBe(2);
  await act(() => useWorkbenchStore.getState().closeView(tab.focusedPaneId));
  await act(() => row.props.onClick({ altKey: false }));
  tab = getActiveTab(useWorkbenchStore.getState());
  expect(tab.panes.get(tab.focusedPaneId)?.target).toEqual(target);
  expect(useWorkbenchStore.getState().tabs.length).toBe(2);
  await act(() => useWorkbenchStore.getState().createTab());
  expect(useWorkbenchStore.getState().tabs.length).toBe(3);
  await act(() => row.props.onClick({ altKey: false }));
  expect(getActiveTab(useWorkbenchStore.getState()).id).toBe(tab.id);
  expect(getActiveTab(useWorkbenchStore.getState()).panes.size).toBe(1);
  expect(useWorkbenchStore.getState().tabs.length).toBe(3);
});

it("requests keyboard focus again when the already-focused Session row is clicked", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const { PaneTree } = await import("../../workbench/PaneTree");
  const { registerViewDefinition, emptyViewBinding, clearViewRegistry } =
    await import("../../workbench/viewRegistry");
  const target = {
    kind: "agentSession",
    environmentId: "local" as EnvironmentId,
    workspaceId: "workspace" as WorkspaceId,
    agentSessionId: "one" as AgentSessionId,
  } as const;
  registerViewDefinition({
    id: "agentSession",
    label: "Agent",
    accepts: (candidate): candidate is typeof target => candidate.kind === "agentSession",
    bind: emptyViewBinding,
    Component: ({ focusRequestId }) => <output>{focusRequestId}</output>,
  });
  function WorkbenchHarness() {
    return <PaneTree snapshot={useWorkbenchStore()} />;
  }
  await act(() => {
    renderer = create(
      <>
        <SessionRow target={target}>Agent</SessionRow>
        <WorkbenchHarness />
      </>,
    );
  });
  const row = renderer!.root.findByProps({ role: "treeitem" });
  await act(() => row.props.onClick({ altKey: false }));
  const firstRequest = renderer!.root.findByType("output").children[0];
  await act(() => row.props.onClick({ altKey: false }));
  expect(renderer!.root.findByType("output").children[0]).not.toBe(firstRequest);
  expect(getActiveTab(useWorkbenchStore.getState()).panes.size).toBe(1);
  clearViewRegistry();
});

it("keeps the URL unchanged for split commands", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const target = {
    kind: "agentSession",
    environmentId: "local" as EnvironmentId,
    workspaceId: "workspace" as WorkspaceId,
    agentSessionId: "one" as AgentSessionId,
  } as const;
  const navigate = vi.fn();

  await act(() => {
    renderer = create(
      <SessionRow navigateTo={navigate} target={target}>
        Agent
      </SessionRow>,
    );
  });
  const row = renderer!.root.findByType("button");
  await act(() => row.props.onClick({ altKey: true }));
  expect(getActiveTab(useWorkbenchStore.getState()).panes).toHaveLength(1);
  expect(navigate).not.toHaveBeenCalled();
});

it("opens capability-gated menu on right-click without navigating", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const target = {
    kind: "agentSession",
    environmentId: "local" as EnvironmentId,
    workspaceId: "workspace" as WorkspaceId,
    agentSessionId: "one" as AgentSessionId,
  } as const;

  showContextMenuMock.mockClear();

  await act(() => {
    renderer = create(<SessionRow target={target}>Agent Row</SessionRow>);
  });

  const row = renderer!.root.findByType("button");
  let prevented = false;
  let stopped = false;
  await act(() => {
    row.props.onContextMenu({
      preventDefault: () => {
        prevented = true;
      },
      stopPropagation: () => {
        stopped = true;
      },
      clientX: 150,
      clientY: 250,
    });
  });

  expect(prevented).toBe(true);
  expect(stopped).toBe(true);
  expect(showContextMenuMock).toHaveBeenCalledWith(
    expect.arrayContaining([
      expect.objectContaining({ id: "open" }),
      expect.objectContaining({ id: "split:right" }),
      expect.objectContaining({ id: "close-session" }),
      expect.objectContaining({ id: "delete-session" }),
    ]),
    { x: 150, y: 250 },
  );

  // Layout should not have changed — no pane opened simply by right-clicking
  expect(
    getActiveTab(useWorkbenchStore.getState()).panes.get(
      getActiveTab(useWorkbenchStore.getState()).focusedPaneId,
    )?.target,
  ).toEqual({ kind: "welcome" });
});

it("supports keyboard context-menu invocation via ContextMenu and Shift+F10", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const target = {
    kind: "agentSession",
    environmentId: "local" as EnvironmentId,
    workspaceId: "workspace" as WorkspaceId,
    agentSessionId: "one" as AgentSessionId,
  } as const;

  showContextMenuMock.mockClear();

  await act(() => {
    renderer = create(<SessionRow target={target}>Agent Row</SessionRow>);
  });

  const row = renderer!.root.findByType("button");
  const bounds = { left: 40, width: 120, bottom: 90 };

  // 1. ContextMenu key
  await act(() => {
    row.props.onKeyDown({
      preventDefault: () => {},
      stopPropagation: () => {},
      key: "ContextMenu",
      currentTarget: { getBoundingClientRect: () => bounds },
    });
  });
  expect(showContextMenuMock).toHaveBeenCalledWith(expect.any(Array), { x: 100, y: 90 });

  showContextMenuMock.mockClear();

  // 2. Shift+F10
  await act(() => {
    row.props.onKeyDown({
      preventDefault: () => {},
      stopPropagation: () => {},
      shiftKey: true,
      key: "F10",
      currentTarget: { getBoundingClientRect: () => bounds },
    });
  });
  expect(showContextMenuMock).toHaveBeenCalledWith(expect.any(Array), { x: 100, y: 90 });
});

it("distinguishes the focused Session from other opened and unopened Sessions", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const target1 = {
    kind: "agentSession",
    environmentId: "local" as EnvironmentId,
    workspaceId: "workspace" as WorkspaceId,
    agentSessionId: "s1" as AgentSessionId,
  } as const;
  const target2 = {
    kind: "agentSession",
    environmentId: "local" as EnvironmentId,
    workspaceId: "workspace" as WorkspaceId,
    agentSessionId: "s2" as AgentSessionId,
  } as const;
  const targeawen = {
    kind: "agentSession",
    environmentId: "local" as EnvironmentId,
    workspaceId: "workspace" as WorkspaceId,
    agentSessionId: "s3" as AgentSessionId,
  } as const;

  await act(() => {
    renderer = create(
      <>
        <SessionRow target={target1}>Session 1</SessionRow>
        <SessionRow target={target2}>Session 2</SessionRow>
        <SessionRow target={targeawen}>Session 3</SessionRow>
      </>,
    );
  });

  const [row1, row2, row3] = renderer!.root.findAllByType("button");

  // Open target1 in the active tab (focused)
  await act(() => row1!.props.onClick({ altKey: false }));

  // Split target2 into the active tab (now target2 is focused)
  await act(() => row2!.props.onClick({ altKey: true, shiftKey: false }));

  // Target2 is now focused in tab, target1 is open in tab but not focused, targeawen is not in tab
  expect(row2!.props["data-session-focused"]).toBe("true");
  expect(row2!.props["aria-current"]).toBe("page");

  expect(row1!.props["data-session-focused"]).toBe("false");
  expect(row1!.props["data-session-open-in-tab"]).toBe("true");
  expect(row1!.props["aria-current"]).toBe("true");

  expect(row3!.props["data-session-focused"]).toBe("false");
  expect(row3!.props["data-session-open-in-tab"]).toBe("false");
  expect(row3!.props["aria-current"]).toBeUndefined();
});

it("marks closed sessions with data-session-closed and suppresses drag initiation on pointerdown", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const target = {
    kind: "agentSession",
    environmentId: "local" as EnvironmentId,
    workspaceId: "workspace" as WorkspaceId,
    agentSessionId: "closed_1" as AgentSessionId,
  } as const;

  const onPointerDown = vi.fn();
  await act(() => {
    renderer = create(
      <SessionRow target={target} isClosed onPointerDown={onPointerDown}>
        Closed Session
      </SessionRow>,
    );
  });

  const row = renderer!.root.findByType("button");
  expect(row.props["data-session-closed"]).toBe("true");

  await act(() => {
    row.props.onPointerDown({
      button: 0,
      currentTarget: {},
      clientX: 50,
      clientY: 50,
      defaultPrevented: false,
    });
  });

  // onPointerDown prop callback is still called, but drag itself is suppressed for closed sessions
  expect(onPointerDown).toHaveBeenCalledTimes(1);
});

it("renders with sidebar-session-row-item class and will-change-transform for fluid movement animation", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const target = {
    kind: "agentSession",
    environmentId: "local" as EnvironmentId,
    workspaceId: "workspace" as WorkspaceId,
    agentSessionId: "s1" as AgentSessionId,
  } as const;

  await act(() => {
    renderer = create(<SessionRow target={target}>Active</SessionRow>);
  });

  const row = renderer!.root.findByType("button");
  expect(row.props.className).toContain("sidebar-session-row-item");
  expect(row.props.className).toContain("will-change-transform");
});


