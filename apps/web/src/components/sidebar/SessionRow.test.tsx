import { act } from "react";
import { create, type ReactTestRenderer } from "react-test-renderer";
import { afterEach, expect, it, vi } from "vite-plus/test";
import type { AgentSessionId, EnvironmentId, WorkspaceId } from "@t3tools/contracts";
import { SessionRow } from "./SessionRow";
import { resetWorkbenchStore, useWorkbenchStore } from "../../workbench/workbenchStore";
import { getActiveTab } from "../../workbench/workbenchState";

let renderer: ReactTestRenderer;
afterEach(async () => {
  await act(() => renderer?.unmount());
  resetWorkbenchStore();
  vi.unstubAllGlobals();
});
it("opens, splits and focuses Agent Sessions by ACode identity, including reopening a closed View", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const target = {
    kind: "agentSession",
    environmentId: "local" as EnvironmentId,
    workspaceId: "workspace" as WorkspaceId,
    agentSessionId: "one" as AgentSessionId,
  } as const;
  await act(() => {
    renderer = create(
      <>
        <SessionRow target={target}>First</SessionRow>
        <SessionRow target={{ ...target, agentSessionId: "two" as AgentSessionId }}>
          Second
        </SessionRow>
      </>,
    );
  });
  const [first, second] = renderer!.root.findAllByType("button");
  await act(() => first!.props.onClick({ altKey: false }));
  expect(getActiveTab(useWorkbenchStore.getState()).panes.size).toBe(1);
  expect([...getActiveTab(useWorkbenchStore.getState()).panes.values()][0]?.target).toEqual(target);
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
  await act(() => useWorkbenchStore.getState().createTab());
  await act(() => row.props.onClick({ altKey: false }));
  expect(getActiveTab(useWorkbenchStore.getState()).panes.size).toBe(1);
  expect(useWorkbenchStore.getState().tabs.length).toBe(2);
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
