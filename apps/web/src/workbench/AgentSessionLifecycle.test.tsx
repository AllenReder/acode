import { act, create, type ReactTestRenderer } from "react-test-renderer";
import { afterEach, beforeEach, expect, it, vi } from "vite-plus/test";
import type { EnvironmentAwenProject } from "@awen/client-runtime/state/models";
import { scopeProjectRef, scopeThreadRef } from "@awen/client-runtime/environment";
import { AgentSessionId, EnvironmentId, ProjectId, ThreadId, WorkspaceId } from "@awen/contracts";
import { DraftId, useComposerDraftStore } from "../composerDraftStore";
import { AgentSessionLifecycle } from "./AgentSessionLifecycle";
import { resetWorkbenchStore, useWorkbenchStore } from "./workbenchStore";
import { getActiveTab } from "./workbenchState";

const remove = vi.fn();
const archive = vi.fn();
const stop = vi.fn();
let shell: Record<string, unknown>;
let messages: unknown[];
vi.mock("../state/entities", () => ({
  readThreadShell: () => shell,
  readThreadDetail: () => ({ messages }),
}));
vi.mock("../state/threads", () => ({
  threadEnvironment: { delete: "delete", archive: "archive", stopSession: "stop" },
}));
vi.mock("../state/use-atom-command", () => ({
  useAtomCommand: (command: string) =>
    command === "delete" ? remove : command === "archive" ? archive : stop,
}));
vi.mock("../components/ui/toast", () => ({
  toastManager: { add: vi.fn() },
  stackedThreadToast: vi.fn(),
}));
const environmentId = EnvironmentId.make("env");
const workspaceId = WorkspaceId.make("workspace");
const threadId = ThreadId.make("thread");
const target = {
  kind: "agentSession" as const,
  environmentId,
  workspaceId,
  agentSessionId: AgentSessionId.make("agent"),
};
const projects = [
  {
    environmentId,
    workspaces: [
      { id: workspaceId, sessions: [{ id: target.agentSessionId, kind: "agent", threadId }] },
    ],
  },
] as unknown as EnvironmentAwenProject[];
let renderer: ReactTestRenderer;
beforeEach(async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  shell = { latestTurn: null, session: null, latestUserMessageAt: null };
  messages = [];
  remove.mockReset().mockResolvedValue({ _tag: "Success" });
  archive.mockReset().mockResolvedValue({ _tag: "Success" });
  stop.mockReset().mockResolvedValue({ _tag: "Success" });
  resetWorkbenchStore();
  useComposerDraftStore.setState(useComposerDraftStore.getInitialState());
  useWorkbenchStore.getState().openTarget(target);
  await act(() => {
    renderer = create(<AgentSessionLifecycle projects={projects} />);
  });
});
afterEach(async () => {
  await act(() => renderer?.unmount());
  resetWorkbenchStore();
  useComposerDraftStore.setState(useComposerDraftStore.getInitialState());
  vi.unstubAllGlobals();
});
it("deletes an untouched Session only when its final Pane closes", async () => {
  const tab = getActiveTab(useWorkbenchStore.getState());
  await act(() =>
    useWorkbenchStore
      .getState()
      .duplicateToNewTab({ kind: "pane", tabId: tab.id, paneId: tab.focusedPaneId }),
  );
  const duplicate = getActiveTab(useWorkbenchStore.getState());
  await act(async () => {
    await useWorkbenchStore.getState().requestClosePane(duplicate.focusedPaneId);
  });
  expect(remove).not.toHaveBeenCalled();
  await act(() => useWorkbenchStore.getState().activateTab(tab.id));
  await act(async () => {
    await useWorkbenchStore.getState().requestClosePane(tab.focusedPaneId);
  });
  expect(remove).toHaveBeenCalledTimes(1);
  expect(archive).not.toHaveBeenCalled();
});
it("closing a Tab uses the same final-View cleanup", async () => {
  const tab = getActiveTab(useWorkbenchStore.getState());
  useWorkbenchStore.getState().createTab();
  await act(() => useWorkbenchStore.getState().closeTab(tab.id));
  expect(remove).toHaveBeenCalledTimes(1);
});
it.each(["prompt", "transcript", "running", "submission"])(
  "preserves %s work when its final View closes",
  async (kind) => {
    if (kind === "prompt")
      useComposerDraftStore.getState().setPrompt(scopeThreadRef(environmentId, threadId), "unsent");
    if (kind === "transcript") messages = [{ role: "assistant", text: "imported history" }];
    if (kind === "running") shell.session = { status: "running" };
    if (kind === "submission")
      useComposerDraftStore.setState({ backgroundSubmissionThreadKeys: { "env:thread": true } });
    const tab = getActiveTab(useWorkbenchStore.getState());
    await act(async () => {
      await useWorkbenchStore.getState().requestClosePane(tab.focusedPaneId);
    });
    expect(remove).not.toHaveBeenCalled();
    expect(archive).not.toHaveBeenCalled();
    expect(stop).not.toHaveBeenCalled();
  },
);
it("resolves an eager draft and canonical Session as the same work", async () => {
  const draftId = DraftId.make("draft");
  useComposerDraftStore
    .getState()
    .setWorkspaceDraftThreadId(
      workspaceId,
      scopeProjectRef(environmentId, ProjectId.make("project")),
      draftId,
      { threadId },
    );
  useWorkbenchStore
    .getState()
    .openTarget({ kind: "newAgentSession", environmentId, workspaceId, draftId });
  const draftTab = getActiveTab(useWorkbenchStore.getState());
  await act(() => useWorkbenchStore.getState().closeTab(draftTab.id));
  expect(remove).not.toHaveBeenCalled();
  useComposerDraftStore.getState().setPrompt(draftId, "draft payload");
  const agentTab = getActiveTab(useWorkbenchStore.getState());
  await act(async () => {
    await useWorkbenchStore.getState().requestClosePane(agentTab.focusedPaneId);
  });
  expect(remove).not.toHaveBeenCalled();
});
it("does not clean up during a View move or draft promotion", async () => {
  const tab = getActiveTab(useWorkbenchStore.getState());
  await act(() =>
    useWorkbenchStore.getState().replaceTarget(tab.focusedPaneId, { kind: "welcome" }),
  );
  expect(remove).not.toHaveBeenCalled();
});
