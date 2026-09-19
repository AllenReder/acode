import { act } from "react";
import { create, type ReactTestRenderer } from "react-test-renderer";
import { afterEach, expect, it, vi } from "vite-plus/test";
import { PaneTree } from "./PaneTree";
import {
  emptyViewBinding,
  clearViewRegistry,
  registerViewDefinition,
  type ViewTarget,
} from "./viewRegistry";
import { resetWorkbenchStore, useWorkbenchStore } from "./workbenchStore";
import { getActiveTab } from "./workbenchState";
import { createWorkspaceViewDefinitions, type WelcomeData } from "./workspaceViews";
import type { EnvironmentId, WorkspaceId, AgentSessionId } from "@t3tools/contracts";

let renderer: ReactTestRenderer | undefined;
afterEach(async () => {
  await act(() => renderer?.unmount());
  clearViewRegistry();
  resetWorkbenchStore();
  vi.unstubAllGlobals();
});

function Harness() {
  return <PaneTree snapshot={useWorkbenchStore()} />;
}

it("passes measured content size and keyboard focus to each View and releases measurement on close", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const observers: { callback: ResizeObserverCallback; disconnect: ReturnType<typeof vi.fn> }[] =
    [];
  vi.stubGlobal(
    "ResizeObserver",
    class {
      disconnect = vi.fn();
      constructor(callback: ResizeObserverCallback) {
        observers.push({ callback, disconnect: this.disconnect });
      }
      observe() {}
    },
  );
  registerViewDefinition({
    id: "workspace",
    label: "Workspace",
    accepts: (target): target is Extract<ViewTarget, { kind: "workspace" }> =>
      target.kind === "workspace",
    bind: emptyViewBinding,
    Component: ({ focused, availableSize }) => (
      <output>{`${focused}:${availableSize.width}x${availableSize.height}`}</output>
    ),
  });
  const first = {
    kind: "workspace",
    environmentId: "local" as EnvironmentId,
    workspaceId: "w1" as WorkspaceId,
  } as const;
  useWorkbenchStore.getState().openTarget(first);
  useWorkbenchStore
    .getState()
    .splitFocused({ ...first, workspaceId: "w2" as WorkspaceId }, "right");
  await act(() => {
    renderer = create(<Harness />, {
      createNodeMock: () => ({ getBoundingClientRect: () => ({ width: 600, height: 400 }) }),
    });
  });
  expect(renderer!.root.findAllByType("output").map((node) => node.children)).toEqual([
    ["false:600x400"],
    ["true:600x400"],
  ]);
  await act(() =>
    observers[0]!.callback(
      [{ contentRect: { width: 320, height: 240 } } as ResizeObserverEntry],
      {} as ResizeObserver,
    ),
  );
  const regions = renderer!.root.findAllByProps({ role: "region" });
  await act(() => regions[0]!.props.onFocus());
  expect(renderer!.root.findAllByType("output").map((node) => node.children)).toEqual([
    ["true:320x240"],
    ["false:600x400"],
  ]);
  await act(() =>
    useWorkbenchStore
      .getState()
      .closeView(getActiveTab(useWorkbenchStore.getState()).focusedPaneId),
  );
  expect(observers[0]!.disconnect).toHaveBeenCalled();
});

it("opens a Workspace from Welcome and opens only that Workspace's Sessions through granted commands", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const workspace = {
    kind: "workspace",
    environmentId: "remote" as EnvironmentId,
    workspaceId: "w1" as WorkspaceId,
  } as const;
  const session = {
    kind: "agentSession",
    environmentId: workspace.environmentId,
    workspaceId: workspace.workspaceId,
    agentSessionId: "s1" as AgentSessionId,
  } as const;
  let data: WelcomeData = [
    {
      target: workspace,
      title: "Main",
      projectTitle: "ACode",
      sessions: [{ title: "Review", target: session }],
    },
  ];
  const listeners = new Set<() => void>();
  const definitions = createWorkspaceViewDefinitions(
    {
      getSnapshot: () => data,
      subscribe: (listener) => {
        listeners.add(listener);
        return () => {
          listeners.delete(listener);
        };
      },
    },
    (target) => useWorkbenchStore.getState().openTarget(target),
  );
  registerViewDefinition(definitions.welcome);
  registerViewDefinition(definitions.workspace);
  await act(() => {
    renderer = create(<Harness />);
  });
  const button = (text: string) =>
    renderer!.root.findAllByType("button").find((node) => node.children.join("") === text)!;
  await act(() => button("ACode / Main").props.onClick());
  expect(renderer!.root.findByType("h1").children).toEqual(["Main"]);
  const commands = definitions.workspace.bind(workspace).capabilities;
  expect(commands.openSession.execute({ ...session, workspaceId: "other" as WorkspaceId })).toBe(
    false,
  );
  await act(() => {
    data = [{ ...data[0]!, title: "Renamed" }];
    listeners.forEach((listener) => listener());
  });
  expect(renderer!.root.findByType("h1").children).toEqual(["Renamed"]);
  await act(() => button("Review").props.onClick());
  expect(
    [...getActiveTab(useWorkbenchStore.getState()).panes.values()].map((view) => view.target),
  ).toEqual([workspace, session]);
  await act(() => {
    data = [];
    listeners.forEach((listener) => listener());
  });
  expect(commands.openSession.execute(session)).toBe(false);
  expect(
    definitions.welcome.bind({ kind: "welcome" }).capabilities.openWorkspace.execute(workspace),
  ).toBe(false);
});
