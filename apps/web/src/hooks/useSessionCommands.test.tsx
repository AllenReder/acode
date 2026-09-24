import { describe, expect, it, vi, beforeEach, afterEach } from "vite-plus/test";
import { act, useLayoutEffect } from "react";
import { create, type ReactTestRenderer } from "react-test-renderer";
import type { AgentSessionId, EnvironmentId, ThreadId, WorkspaceId } from "@awen/contracts";
import { useSessionCommands } from "./useSessionCommands";

const deleteMock = vi.fn();
const archiveMock = vi.fn();
const stopSessionMock = vi.fn();
const closeTerminalMock = vi.fn();
const removeSessionViewsMock = vi.fn();
const readThreadShellMock = vi.fn();
const useAwenAgentSessionShellMock = vi.fn();

vi.mock("../state/use-atom-command", () => ({
  useAtomCommand: (cmd: unknown) => {
    if (cmd === "mock-delete") return deleteMock;
    if (cmd === "mock-archive") return archiveMock;
    if (cmd === "mock-stop") return stopSessionMock;
    if (cmd === "mock-terminal-close") return closeTerminalMock;
    return vi.fn();
  },
}));

vi.mock("../state/threads", () => ({
  threadEnvironment: {
    delete: "mock-delete",
    archive: "mock-archive",
    stopSession: "mock-stop",
  },
}));

vi.mock("../state/terminal", () => ({
  terminalEnvironment: {
    close: "mock-terminal-close",
  },
}));

vi.mock("../state/entities", () => ({
  readThreadShell: (ref: unknown) => readThreadShellMock(ref),
  useAwenAgentSessionShell: (env: unknown, ws: unknown, id: unknown) =>
    useAwenAgentSessionShellMock(env, ws, id),
}));

vi.mock("../workbench/workbenchStore", () => ({
  useWorkbenchStore: () => ({
    removeSessionViews: removeSessionViewsMock,
    openTarget: vi.fn(),
    setFocused: vi.fn(),
    splitFocused: vi.fn(),
  }),
}));

vi.mock("../components/ui/toast", () => ({
  toastManager: { add: vi.fn() },
  stackedThreadToast: vi.fn(),
}));

describe("useSessionCommands zero-turn session cleanup", () => {
  const target = {
    kind: "agentSession" as const,
    environmentId: "env-1" as EnvironmentId,
    workspaceId: "ws-1" as WorkspaceId,
    agentSessionId: "session-1" as AgentSessionId,
  };

  let renderer: ReactTestRenderer | undefined;
  let commandsHandle: ReturnType<typeof useSessionCommands> | undefined;

  function Probe() {
    const commands = useSessionCommands(target);
    useLayoutEffect(() => {
      commandsHandle = commands;
    });
    return null;
  }

  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    useAwenAgentSessionShellMock.mockReturnValue({
      id: "session-1",
      threadId: "thread-1" as ThreadId,
      title: "New Agent Session",
    });
  });

  afterEach(() => {
    if (renderer) {
      act(() => renderer?.unmount());
      renderer = undefined;
    }
    vi.unstubAllGlobals();
  });

  it("permanently deletes zero-turn sessions upon close instead of archiving to history", async () => {
    deleteMock.mockResolvedValue({ _tag: "Success" });
    // zero-turn: latestTurn and session are both null
    readThreadShellMock.mockReturnValue({
      id: "thread-1",
      latestTurn: null,
      session: null,
    });

    act(() => {
      renderer = create(<Probe />);
    });

    await act(async () => {
      await commandsHandle?.closeSession();
    });

    expect(deleteMock).toHaveBeenCalledWith({
      environmentId: "env-1",
      input: { threadId: "thread-1" },
    });
    expect(archiveMock).not.toHaveBeenCalled();
    expect(removeSessionViewsMock).toHaveBeenCalledWith(target);
  });

  it("archives sessions with existing turns into history upon close", async () => {
    archiveMock.mockResolvedValue({ _tag: "Success" });
    // has completed turns
    readThreadShellMock.mockReturnValue({
      id: "thread-1",
      latestTurn: { turnId: "turn-1", status: "completed" },
      session: null,
    });

    act(() => {
      renderer = create(<Probe />);
    });

    await act(async () => {
      await commandsHandle?.closeSession();
    });

    expect(archiveMock).toHaveBeenCalledWith({
      environmentId: "env-1",
      input: { threadId: "thread-1" },
    });
    expect(deleteMock).not.toHaveBeenCalled();
    expect(removeSessionViewsMock).toHaveBeenCalledWith(target);
  });
});
