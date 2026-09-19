import { act } from "react";
import { create, type ReactTestRenderer } from "react-test-renderer";
import { afterEach, expect, it, vi } from "vite-plus/test";
import type { AgentSessionId, EnvironmentId, WorkspaceId } from "@t3tools/contracts";
import { AgentView } from "./AgentView";
import { TerminalView } from "./TerminalView";
import { terminalTargetForRuntime } from "./sessionTarget";
import { resetWorkbenchStore, useWorkbenchStore } from "./workbenchStore";
import { getActiveTab } from "./workbenchState";

// The trusted runtime adapters are the agreed integration boundary. Present
// their inputs as text, without starting a provider, PTY, or GPU in Node.
vi.mock("../state/entities", () => ({
  useAcodeAgentSessionShell: (_environment: unknown, _workspace: unknown, session: string) => ({
    threadId: `thread-${session}`,
    status: session === "closed-session" ? "closed" : "open",
  }),
  useAcodeWorkspace: () => ({ workspaceRoot: "/checkout" }),
}));
vi.mock("../components/ChatView", () => ({
  default: (props: unknown) => <output>{JSON.stringify(props)}</output>,
}));
vi.mock("../components/ThreadTerminalDrawer", () => ({
  TerminalViewport: (props: unknown) => <output>{JSON.stringify(props)}</output>,
}));
let renderer: ReactTestRenderer;
afterEach(async () => {
  await act(() => renderer?.unmount());
  vi.unstubAllGlobals();
});
const environmentId = "local" as EnvironmentId;
const workspaceId = "workspace" as WorkspaceId;
const availableSize = { width: 640, height: 480 };

it("isolates Agent data by Session target and forwards focus and measured size to the existing presentation", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  await act(() => {
    renderer = create(
      <>
        {["one", "two"].map((id) => (
          <AgentView
            key={id}
            target={{
              kind: "agentSession",
              environmentId,
              workspaceId,
              agentSessionId: id as AgentSessionId,
            }}
            paneId={id}
            focused={id === "two"}
            availableSize={availableSize}
          />
        ))}
      </>,
    );
  });
  expect(
    renderer!.root.findAllByType("output").map((node) => JSON.parse(node.children[0] as string)),
  ).toEqual([
    expect.objectContaining({ threadId: "thread-one", focused: false, availableSize }),
    expect.objectContaining({ threadId: "thread-two", focused: true, availableSize }),
  ]);
});

it("reattaches the same Terminal identity and forwards changing Pane dimensions and focus", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const target = terminalTargetForRuntime({ environmentId, workspaceId, terminalId: "shell" });
  await act(() => {
    renderer = create(
      <TerminalView target={target} paneId="pane" focused={false} availableSize={availableSize} />,
    );
  });
  const read = () => JSON.parse(renderer!.root.findByType("output").children[0] as string);
  expect(read()).toMatchObject({ workspaceId, terminalId: "shell", focused: false, availableSize });
  const resized = { width: 320, height: 240 };
  await act(() =>
    renderer.update(<TerminalView target={target} paneId="pane" focused availableSize={resized} />),
  );
  expect(read()).toMatchObject({
    workspaceId,
    terminalId: "shell",
    focused: true,
    autoFocus: true,
    availableSize: resized,
  });
  await act(() => renderer.unmount());
  await act(() => {
    renderer = create(
      <TerminalView target={target} paneId="new-pane" focused availableSize={resized} />,
    );
  });
  expect(read()).toMatchObject({ workspaceId, terminalId: "shell" });
});

it("renders closed read-only status banner when viewing a closed Agent Session from History", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  await act(() => {
    renderer = create(
      <AgentView
        target={{
          kind: "agentSession",
          environmentId,
          workspaceId,
          agentSessionId: "closed-session" as AgentSessionId,
        }}
        paneId="closed-pane"
        focused={false}
        availableSize={availableSize}
      />,
    );
  });

  const banner = renderer!.root.findByProps({ role: "status" });
  expect(banner).toBeDefined();
  const text = banner
    .findAllByType("span")
    .map((n) => n.children.join(""))
    .join(" ");
  expect(text).toContain("This Agent Session is closed and preserved in Workspace History.");
});
it("removes closed Session across multiple tabs while closeView detaches only the current View", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const targetA = {
    kind: "agentSession",
    environmentId,
    workspaceId,
    agentSessionId: "one" as AgentSessionId,
  } as const;
  const targetB = {
    kind: "agentSession",
    environmentId,
    workspaceId,
    agentSessionId: "two" as AgentSessionId,
  } as const;

  const store = useWorkbenchStore.getState();
  store.openTarget(targetA);
  store.splitFocused(targetB, "right");
  const tab1Id = getActiveTab(useWorkbenchStore.getState()).id;

  store.createTab();
  store.openTarget(targetA);
  const tab2Id = getActiveTab(useWorkbenchStore.getState()).id;

  expect(useWorkbenchStore.getState().tabs).toHaveLength(2);

  // 1. closeView on Tab 2 detaches only that ViewInstance
  const tab2PaneId = getActiveTab(useWorkbenchStore.getState()).focusedPaneId;
  store.closeView(tab2PaneId);
  const tab2 = getActiveTab(useWorkbenchStore.getState());
  expect(tab2.panes.get(tab2.focusedPaneId)?.target.kind).toBe("welcome");

  // Tab 1 still holds targetA
  store.activateTab(tab1Id);
  expect(getActiveTab(useWorkbenchStore.getState()).panes.size).toBe(2);

  // 2. removeSessionViews removes targetA from ALL tabs
  useWorkbenchStore.getState().removeSessionViews(targetA);
  const tab1Panes = getActiveTab(useWorkbenchStore.getState()).panes;
  expect(tab1Panes.size).toBe(1);
  expect([...tab1Panes.values()][0]?.target).toEqual(targetB);
});
