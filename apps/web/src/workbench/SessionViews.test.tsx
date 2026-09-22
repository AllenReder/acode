import { act } from "react";
import { create, type ReactTestRenderer } from "react-test-renderer";
import { afterEach, expect, it, vi } from "vite-plus/test";
import {
  ThreadId,
  type AgentSessionId,
  type EnvironmentId,
  type ProjectId,
  type WorkspaceId,
} from "@awen/contracts";
import { scopeProjectRef } from "@awen/client-runtime/environment";
import { AgentView } from "./AgentView";
import { NewAgentSessionView } from "./NewAgentSessionView";
import { TerminalView } from "./TerminalView";
import { terminalTargetForRuntime } from "./sessionTarget";
import { resetWorkbenchStore, useWorkbenchStore } from "./workbenchStore";
import { getActiveTab } from "./workbenchState";
import { DraftId, useComposerDraftStore } from "../composerDraftStore";

// The trusted runtime adapters are the agreed integration boundary. Present
// their inputs as text, without starting a provider, PTY, or GPU in Node.
vi.mock("../state/entities", () => ({
  useAwenProjects: () => [],
  useAwenAgentSessionShell: (_environment: unknown, _workspace: unknown, session: string) => ({
    threadId: `thread-${session}`,
    status: session === "closed-session" ? "closed" : "open",
  }),
  useAwenWorkspace: () => ({ workspaceRoot: "/checkout" }),
  useThread: () => null,
  useThreadShell: () => null,
}));
vi.mock("@tanstack/react-router", () => ({
  useNavigate: () => vi.fn(),
}));
vi.mock("../components/ChatView", () => ({
  default: (props: Record<string, unknown>) => <output {...props}>{JSON.stringify(props)}</output>,
}));
vi.mock("../components/ThreadTerminalDrawer", () => ({
  TerminalViewport: (props: unknown) => <output>{JSON.stringify(props)}</output>,
}));
let renderer: ReactTestRenderer;
const initialComposerState = useComposerDraftStore.getInitialState();
afterEach(async () => {
  await act(() => renderer?.unmount());
  useComposerDraftStore.setState(initialComposerState);
  vi.unstubAllGlobals();
});
const environmentId = "local" as EnvironmentId;
const workspaceId = "workspace" as WorkspaceId;
const availableSize = { width: 640, height: 480 };

it("renders a New Agent Session View from its Workspace draft before Session promotion", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const draftId = DraftId.make("draft-one");
  const threadId = ThreadId.make("thread-reserved");
  useComposerDraftStore
    .getState()
    .setWorkspaceDraftThreadId(
      workspaceId,
      scopeProjectRef(environmentId, "project" as ProjectId),
      draftId,
      { threadId },
    );

  await act(() => {
    renderer = create(
      <NewAgentSessionView
        target={{ kind: "newAgentSession", environmentId, workspaceId, draftId }}
        paneId="draft-pane"
        focused
        availableSize={availableSize}
      />,
    );
  });

  expect(JSON.parse(renderer!.root.findByType("output").children[0] as string)).toMatchObject({
    environmentId,
    threadId,
    routeKind: "draft",
    draftId,
    focused: true,
    availableSize,
  });
});

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
it("detaches only the current View on closeView and removes the Session's View on removeSessionViews", async () => {
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
  const tab1Id = getActiveTab(useWorkbenchStore.getState()).id;

  // A second Tab holds a different Session: ADR-0010 gives each Session one View.
  store.openTarget(targetB);
  const tab2Id = getActiveTab(useWorkbenchStore.getState()).id;
  expect(tab2Id).not.toBe(tab1Id);
  expect(useWorkbenchStore.getState().tabs).toHaveLength(2);

  // 1. closeView on Tab 2 detaches only that ViewInstance
  const tab2PaneId = getActiveTab(useWorkbenchStore.getState()).focusedPaneId;
  store.closeView(tab2PaneId);
  const tab2 = getActiveTab(useWorkbenchStore.getState());
  expect(tab2.panes.get(tab2.focusedPaneId)?.target.kind).toBe("welcome");

  // Tab 1 still holds targetA
  store.activateTab(tab1Id);
  expect(getActiveTab(useWorkbenchStore.getState()).panes.size).toBe(1);
  expect([...getActiveTab(useWorkbenchStore.getState()).panes.values()][0]?.target).toEqual(
    targetA,
  );

  // 2. removeSessionViews removes targetA's View and leaves the other Tab alone
  useWorkbenchStore.getState().removeSessionViews(targetA);
  const tab1Panes = getActiveTab(useWorkbenchStore.getState()).panes;
  expect(tab1Panes.size).toBe(1);
  expect([...tab1Panes.values()][0]?.target.kind).toBe("welcome");
  expect(useWorkbenchStore.getState().tabs.find((tab) => tab.id === tab2Id)).toBeDefined();
});

it("binds workspace actions (browse files, new terminal) from AgentView to ChatView", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  resetWorkbenchStore();
  const target = {
    kind: "agentSession" as const,
    environmentId,
    workspaceId,
    agentSessionId: "one" as AgentSessionId,
  };
  useWorkbenchStore.getState().openTarget(target);
  const sourcePaneId = getActiveTab(useWorkbenchStore.getState()).focusedPaneId;

  await act(() => {
    renderer = create(
      <AgentView target={target} paneId={sourcePaneId} focused availableSize={availableSize} />,
    );
  });

  const output = renderer!.root.findByType("output");
  expect(typeof output.props.onBrowseFiles).toBe("function");
  expect(typeof output.props.onNewTerminalSession).toBe("function");

  await act(() => output.props.onBrowseFiles());
  const tab = getActiveTab(useWorkbenchStore.getState());
  expect(tab.panes.size).toBe(2);
  expect(tab.panes.get(tab.focusedPaneId)?.target).toEqual({
    kind: "workspace",
    definitionId: "fileView",
    environmentId,
    workspaceId,
  });
});
