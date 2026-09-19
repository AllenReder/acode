import * as Schema from "effect/Schema";
import { describe, expect, it } from "vite-plus/test";

import { AgentSessionId, TerminalSessionId, ThreadId, WorkspaceId } from "./baseSchemas.ts";
import {
  agentSessionRefForShell,
  runtimeTerminalIdForSession,
  sessionRefForShell,
  SessionRef,
  terminalSessionRefForRuntime,
  type TerminalSessionRef,
} from "./session.ts";
import { AcodeProjectShell, AcodeSessionShell, agentSessionsIn } from "./workspace.ts";
import type { AcodeAgentSessionShell } from "./workspace.ts";

const WS_A = WorkspaceId.make("workspace:project-a");
const WS_B = WorkspaceId.make("workspace:project-b");
const AGENT = AgentSessionId.make("agent-session:event-1");
const THREAD = ThreadId.make("thread-1");

function decodeSync<S extends Schema.Top>(schema: S, input: unknown): Schema.Schema.Type<S> {
  return Schema.decodeUnknownSync(schema as never)(input) as Schema.Schema.Type<S>;
}

function decodes<S extends Schema.Top>(schema: S, input: unknown): boolean {
  try {
    Schema.decodeUnknownSync(schema as never)(input);
    return true;
  } catch {
    return false;
  }
}

function agentShell(overrides: Partial<AcodeAgentSessionShell> = {}): AcodeAgentSessionShell {
  return {
    kind: "agent",
    id: AGENT,
    workspaceId: WS_A,
    threadId: THREAD,
    title: "Agent session",
    createdAt: "2026-09-19T00:00:00.000Z",
    updatedAt: "2026-09-19T00:00:00.000Z",
    ...overrides,
  };
}

describe("Terminal Session references", () => {
  it("gives the same runtime terminal one stable ACode identity", () => {
    const first = terminalSessionRefForRuntime({ workspaceId: WS_A, terminalId: "term-1" });
    const second = terminalSessionRefForRuntime({ workspaceId: WS_A, terminalId: "term-1" });

    expect(first.terminalSessionId).toBe(second.terminalSessionId);
  });

  it("keeps the same runtime terminal id distinct across Workspaces", () => {
    const inA = terminalSessionRefForRuntime({ workspaceId: WS_A, terminalId: "term-1" });
    const inB = terminalSessionRefForRuntime({ workspaceId: WS_B, terminalId: "term-1" });

    expect(inA.terminalSessionId).not.toBe(inB.terminalSessionId);
  });

  it("owns exactly one Workspace and does not adopt the runtime terminal id", () => {
    const ref = terminalSessionRefForRuntime({ workspaceId: WS_A, terminalId: "term-1" });

    expect(ref.kind).toBe("terminal");
    expect(ref.workspaceId).toBe(WS_A);
    expect(ref.terminalSessionId).not.toBe("term-1");
  });

  it("resolves a Session back to the runtime terminal id it was adapted from", () => {
    const ref = terminalSessionRefForRuntime({ workspaceId: WS_A, terminalId: "term-7" });

    expect(runtimeTerminalIdForSession(ref)).toBe("term-7");
  });

  it("round-trips a runtime id that contains the ACode identity separator", () => {
    const ref = terminalSessionRefForRuntime({ workspaceId: WS_A, terminalId: "shell:zsh:1" });

    expect(runtimeTerminalIdForSession(ref)).toBe("shell:zsh:1");
  });

  it("keeps distinct runtime pairs from colliding when either id contains the separator", () => {
    const left = terminalSessionRefForRuntime({
      workspaceId: WorkspaceId.make("a:b"),
      terminalId: "c",
    });
    const right = terminalSessionRefForRuntime({
      workspaceId: WorkspaceId.make("a"),
      terminalId: "b:c",
    });

    expect(left.terminalSessionId).not.toBe(right.terminalSessionId);
    expect(runtimeTerminalIdForSession(left)).toBe("c");
    expect(runtimeTerminalIdForSession(right)).toBe("b:c");
  });

  it("reports no runtime binding for an identity the adapter did not produce", () => {
    const foreign: TerminalSessionRef = {
      kind: "terminal",
      workspaceId: WS_A,
      terminalSessionId: TerminalSessionId.make("terminal-session:elsewhere:term-1"),
    };

    expect(runtimeTerminalIdForSession(foreign)).toBeNull();
  });
});

describe("Agent Session references", () => {
  it("binds the ACode Agent Session to its Workspace without exposing the T3 thread", () => {
    const ref = agentSessionRefForShell(agentShell());

    expect(ref).toEqual({
      kind: "agent",
      workspaceId: WS_A,
      agentSessionId: AGENT,
    });
  });

  it("keeps the same ACode identity when only the Thread binding differs", () => {
    const before = agentSessionRefForShell(agentShell());
    const rebound = agentSessionRefForShell(agentShell({ threadId: ThreadId.make("thread-2") }));

    expect(rebound).toEqual(before);
  });
});

describe("SessionRef", () => {
  it("decodes both Session kinds under one shared contract", () => {
    const agent = decodeSync(SessionRef, {
      kind: "agent",
      workspaceId: WS_A,
      agentSessionId: AGENT,
    });
    const terminal = decodeSync(SessionRef, {
      kind: "terminal",
      workspaceId: WS_A,
      terminalSessionId: "terminal-session:workspace:project-a:term-1",
    });

    expect(agent.kind).toBe("agent");
    expect(terminal.kind).toBe("terminal");
    expect(agent.workspaceId).toBe(WS_A);
    expect(terminal.workspaceId).toBe(WS_A);
  });

  it("rejects a kind paired with the other Session kind's identity", () => {
    expect(
      decodes(SessionRef, { kind: "agent", workspaceId: WS_A, terminalSessionId: "term-1" }),
    ).toBe(false);
    expect(
      decodes(SessionRef, { kind: "terminal", workspaceId: WS_A, agentSessionId: AGENT }),
    ).toBe(false);
  });

  it("requires an owning Workspace on every Session reference", () => {
    expect(decodes(SessionRef, { kind: "agent", agentSessionId: AGENT })).toBe(false);
    expect(
      decodes(SessionRef, { kind: "terminal", terminalSessionId: "terminal-session:x:term-1" }),
    ).toBe(false);
  });
});

describe("AcodeSessionShell", () => {
  it("carries the same Workspace-scoped Session fields for both Session kinds", () => {
    const agent = decodeSync(AcodeSessionShell, {
      kind: "agent",
      id: AGENT,
      workspaceId: WS_A,
      threadId: THREAD,
      title: "Agent session",
      createdAt: "2026-09-19T00:00:00.000Z",
      updatedAt: "2026-09-19T00:00:00.000Z",
    });
    const terminal = decodeSync(AcodeSessionShell, {
      kind: "terminal",
      id: "terminal-session:workspace:project-a:term-1",
      workspaceId: WS_A,
      title: "Terminal",
      createdAt: "2026-09-19T00:00:00.000Z",
      updatedAt: "2026-09-19T00:00:00.000Z",
    });

    expect([agent.kind, terminal.kind]).toEqual(["agent", "terminal"]);
    expect(agent.workspaceId).toBe(terminal.workspaceId);
  });

  it("keeps the T3 thread binding on the Agent shell only", () => {
    const agent = decodeSync(AcodeSessionShell, { ...agentShell(), kind: "agent" });
    const terminal = decodeSync(AcodeSessionShell, {
      kind: "terminal",
      id: "terminal-session:workspace:project-a:term-1",
      workspaceId: WS_A,
      title: "Terminal",
      createdAt: "2026-09-19T00:00:00.000Z",
      updatedAt: "2026-09-19T00:00:00.000Z",
    });

    expect(agent).toMatchObject({ kind: "agent", threadId: THREAD });
    expect(terminal).not.toHaveProperty("threadId");
  });

  it("maps a shell to the shared reference without revealing runtime identity", () => {
    const agent = sessionRefForShell(agentShell());
    const terminal = sessionRefForShell({
      kind: "terminal",
      id: TerminalSessionId.make("terminal-session:workspace:project-a:term-1"),
      workspaceId: WS_A,
      title: "Terminal",
      createdAt: "2026-09-19T00:00:00.000Z",
      updatedAt: "2026-09-19T00:00:00.000Z",
    });

    expect(agent).not.toHaveProperty("threadId");
    expect(terminal).not.toHaveProperty("terminalId");
    expect(JSON.stringify([agent, terminal])).not.toContain('"threadId"');
  });

  it("still decodes an Agent shell from a server that predates the kind discriminant", () => {
    const legacy = decodeSync(AcodeSessionShell, {
      id: AGENT,
      workspaceId: WS_A,
      threadId: THREAD,
      title: "Agent session",
      createdAt: "2026-09-19T00:00:00.000Z",
      updatedAt: "2026-09-19T00:00:00.000Z",
    });

    expect(legacy.kind).toBe("agent");
    expect(legacy.id).toBe(AGENT);
  });
});

describe("agentSessionsIn", () => {
  it("returns only Agent Sessions from a Workspace projecting both kinds", () => {
    const workspace = {
      sessions: [
        { ...agentShell() },
        {
          kind: "terminal" as const,
          id: TerminalSessionId.make("terminal-session:workspace:project-a:term-1"),
          workspaceId: WS_A,
          title: "Terminal",
          createdAt: "2026-09-19T00:00:00.000Z",
          updatedAt: "2026-09-19T00:00:00.000Z",
        },
      ],
    };

    const agentSessions = agentSessionsIn(workspace);

    expect(agentSessions).toHaveLength(1);
    expect(agentSessions[0]?.id).toBe(AGENT);
  });

  it("returns no Agent Sessions for a Workspace that only has Terminal Sessions", () => {
    const agentSessions = agentSessionsIn({
      sessions: [
        {
          kind: "terminal",
          id: TerminalSessionId.make("terminal-session:workspace:project-a:term-1"),
          workspaceId: WS_A,
          title: "Terminal",
          createdAt: "2026-09-19T00:00:00.000Z",
          updatedAt: "2026-09-19T00:00:00.000Z",
        },
      ],
    });

    expect(agentSessions).toEqual([]);
  });

  it("treats a Workspace with no projected Sessions as having none", () => {
    expect(agentSessionsIn({})).toEqual([]);
  });
});

describe("Workspace Session projection compatibility", () => {
  it("keeps decoding the ACode Project tree when a newer server sends an unknown Session kind", () => {
    const project = decodeSync(AcodeProjectShell, {
      id: "acode-project:p",
      title: "Project",
      workspaces: [
        {
          id: WS_A,
          projectId: "acode-project:p",
          t3ProjectId: "project-p",
          title: "Workspace",
          workspaceRoot: "/tmp/p",
          role: "main",
          sessions: [
            { ...agentShell() },
            {
              kind: "plugin",
              id: "plugin-session:1",
              workspaceId: WS_A,
              title: "Plugin session",
              createdAt: "2026-09-19T00:00:00.000Z",
              updatedAt: "2026-09-19T00:00:00.000Z",
            },
          ],
          createdAt: "2026-09-19T00:00:00.000Z",
          updatedAt: "2026-09-19T00:00:00.000Z",
        },
      ],
      createdAt: "2026-09-19T00:00:00.000Z",
      updatedAt: "2026-09-19T00:00:00.000Z",
    });

    // The Agent Session this build understands survives; the unknown kind is
    // dropped instead of taking down the whole project tree.
    expect(agentSessionsIn(project.workspaces[0]!)).toHaveLength(1);
  });

  it("keeps a pre-discriminant Agent Session visible to the Agent-only projection", () => {
    const project = decodeSync(AcodeProjectShell, {
      id: "acode-project:p",
      title: "Project",
      workspaces: [
        {
          id: WS_A,
          projectId: "acode-project:p",
          t3ProjectId: "project-p",
          title: "Workspace",
          workspaceRoot: "/tmp/p",
          role: "main",
          sessions: [
            {
              id: AGENT,
              workspaceId: WS_A,
              threadId: THREAD,
              title: "Agent session",
              createdAt: "2026-09-19T00:00:00.000Z",
              updatedAt: "2026-09-19T00:00:00.000Z",
            },
          ],
          createdAt: "2026-09-19T00:00:00.000Z",
          updatedAt: "2026-09-19T00:00:00.000Z",
        },
      ],
      createdAt: "2026-09-19T00:00:00.000Z",
      updatedAt: "2026-09-19T00:00:00.000Z",
    });

    const sessions = agentSessionsIn(project.workspaces[0]!);
    expect(sessions).toHaveLength(1);
    expect(sessions[0]?.threadId).toBe(THREAD);
  });
});
