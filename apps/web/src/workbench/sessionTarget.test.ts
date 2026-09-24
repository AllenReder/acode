import { describe, expect, it } from "vite-plus/test";

import type { EnvironmentId, WorkspaceId } from "@awen/contracts";

import { runtimeTerminalIdForTarget, terminalTargetForRuntime } from "./sessionTarget";
import { targetKey } from "./viewRegistry";

const ENV_A: EnvironmentId = "env-a" as EnvironmentId;
const ENV_B: EnvironmentId = "env-b" as EnvironmentId;
const WS_A: WorkspaceId = "ws-a" as WorkspaceId;
const WS_B: WorkspaceId = "ws-b" as WorkspaceId;

describe("terminalTargetForRuntime", () => {
  it("binds a runtime terminal to a workbench target with a typed Awen Session identity", () => {
    const target = terminalTargetForRuntime({
      environmentId: ENV_A,
      workspaceId: WS_A,
      terminalId: "term-1",
    });

    expect(target.kind).toBe("workspaceTerminal");
    expect(target.workspaceId).toBe(WS_A);
    // The runtime PTY id is not the product-level target identity.
    expect(target.terminalSessionId).not.toBe("term-1");
  });

  it("gives one runtime terminal the same target identity on every call", () => {
    const first = terminalTargetForRuntime({
      environmentId: ENV_A,
      workspaceId: WS_A,
      terminalId: "term-1",
    });
    const second = terminalTargetForRuntime({
      environmentId: ENV_A,
      workspaceId: WS_A,
      terminalId: "term-1",
    });

    expect(targetKey(first)).toBe(targetKey(second));
  });
});

describe("runtimeTerminalIdForTarget", () => {
  it("resolves a workbench target back to the runtime terminal it adapts", () => {
    const target = terminalTargetForRuntime({
      environmentId: ENV_A,
      workspaceId: WS_A,
      terminalId: "term-7",
    });

    expect(runtimeTerminalIdForTarget(target)).toBe("term-7");
  });

  it("keeps the same terminal id distinct across Workspaces", () => {
    const inA = terminalTargetForRuntime({
      environmentId: ENV_A,
      workspaceId: WS_A,
      terminalId: "term-1",
    });
    const inB = terminalTargetForRuntime({
      environmentId: ENV_A,
      workspaceId: WS_B,
      terminalId: "term-1",
    });

    expect(targetKey(inA)).not.toBe(targetKey(inB));
    expect(runtimeTerminalIdForTarget(inA)).toBe("term-1");
    expect(runtimeTerminalIdForTarget(inB)).toBe("term-1");
  });

  it("scopes the same terminal id and Workspace by Environment", () => {
    const inA = terminalTargetForRuntime({
      environmentId: ENV_A,
      workspaceId: WS_A,
      terminalId: "term-1",
    });
    const inB = terminalTargetForRuntime({
      environmentId: ENV_B,
      workspaceId: WS_A,
      terminalId: "term-1",
    });

    expect(targetKey(inA)).not.toBe(targetKey(inB));
  });
});
