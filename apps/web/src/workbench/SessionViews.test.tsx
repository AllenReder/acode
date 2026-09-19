import { act } from "react";
import { create, type ReactTestRenderer } from "react-test-renderer";
import { afterEach, expect, it, vi } from "vite-plus/test";
import type { AgentSessionId, EnvironmentId, WorkspaceId } from "@t3tools/contracts";
import { AgentView } from "./AgentView";
import { TerminalView } from "./TerminalView";
import { terminalTargetForRuntime } from "./sessionTarget";

// The trusted runtime adapters are the agreed integration boundary. Present
// their inputs as text, without starting a provider, PTY, or GPU in Node.
vi.mock("../state/entities", () => ({
  useAcodeAgentSessionShell: (_environment: unknown, _workspace: unknown, session: string) => ({
    threadId: `thread-${session}`,
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
