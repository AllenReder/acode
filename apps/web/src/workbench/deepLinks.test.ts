import { describe, expect, it } from "vite-plus/test";

import type {
  AcodeProjectId,
  AgentSessionId,
  EnvironmentId,
  ProjectId,
  TerminalSessionId,
  ThreadId,
  WorkspaceId,
} from "@t3tools/contracts";
import type { EnvironmentAcodeProject } from "@t3tools/client-runtime/state/models";

import { deepLinkInputFromParams, resolveDeepLink, sessionRouteForTarget } from "./deepLinks";

const ENV: EnvironmentId = "env-a" as EnvironmentId;
const WS: WorkspaceId = "ws-a" as WorkspaceId;
const AGENT: AgentSessionId = "agent-x" as AgentSessionId;
const TERMINAL: TerminalSessionId = "terminal-x" as TerminalSessionId;
const THREAD: ThreadId = "thread-x" as ThreadId;
const PROJECT_ID: ProjectId = "project-a" as ProjectId;
const ACODE_PROJECT_ID: AcodeProjectId = "acode-project-a" as AcodeProjectId;

const ENVIRONMENT_READY = {
  catalogReady: true,
  environmentExists: true,
  environmentEnabled: true,
  environmentSnapshotPresent: true,
};

function project(
  workspaces: ReadonlyArray<{
    readonly id: WorkspaceId;
    readonly sessions?: EnvironmentAcodeProject["workspaces"][number]["sessions"];
    readonly historySessions?: EnvironmentAcodeProject["workspaces"][number]["historySessions"];
  }>,
): EnvironmentAcodeProject {
  return {
    id: ACODE_PROJECT_ID,
    environmentId: ENV,
    title: "Project A",
    workspaces: workspaces.map((workspace) => ({
      id: workspace.id,
      projectId: ACODE_PROJECT_ID,
      t3ProjectId: PROJECT_ID,
      title: "Workspace",
      workspaceRoot: "/tmp/a",
      role: "main" as const,
      createdAt: "2026-01-01T00:00:00Z",
      updatedAt: "2026-01-01T00:00:00Z",
      ...(workspace.sessions ? { sessions: workspace.sessions } : {}),
      ...(workspace.historySessions ? { historySessions: workspace.historySessions } : {}),
    })),
    createdAt: "2026-01-01T00:00:00Z",
    updatedAt: "2026-01-01T00:00:00Z",
  };
}

const agentTarget = {
  kind: "agentSession",
  environmentId: ENV,
  workspaceId: WS,
  agentSessionId: AGENT,
} as const;

const terminalTarget = {
  kind: "workspaceTerminal",
  environmentId: ENV,
  workspaceId: WS,
  terminalSessionId: TERMINAL,
} as const;

describe("canonical route helpers", () => {
  it("builds separate Agent and Terminal canonical routes", () => {
    expect(sessionRouteForTarget(agentTarget)).toEqual({
      to: "/$environmentId/workspaces/$workspaceId/agent-sessions/$agentSessionId",
      params: {
        environmentId: ENV,
        workspaceId: WS,
        agentSessionId: AGENT,
      },
    });
    expect(sessionRouteForTarget(terminalTarget)).toEqual({
      to: "/$environmentId/workspaces/$workspaceId/terminal-sessions/$terminalSessionId",
      params: {
        environmentId: ENV,
        workspaceId: WS,
        terminalSessionId: TERMINAL,
      },
    });
  });

  it("parses canonical params and rejects mixed or incomplete inputs", () => {
    expect(
      deepLinkInputFromParams({
        environmentId: ENV,
        workspaceId: WS,
        agentSessionId: AGENT,
      }),
    ).toEqual({
      kind: "agentSession",
      environmentId: ENV,
      workspaceId: WS,
      agentSessionId: AGENT,
    });
    expect(
      deepLinkInputFromParams({
        environmentId: ENV,
        workspaceId: WS,
        terminalSessionId: TERMINAL,
      }),
    ).toEqual({
      kind: "workspaceTerminal",
      environmentId: ENV,
      workspaceId: WS,
      terminalSessionId: TERMINAL,
    });
    expect(
      deepLinkInputFromParams({
        environmentId: ENV,
        workspaceId: WS,
        agentSessionId: AGENT,
        terminalSessionId: TERMINAL,
      }),
    ).toBeNull();
    expect(deepLinkInputFromParams({ environmentId: ENV, workspaceId: WS })).toBeNull();
  });
});

describe("resolveDeepLink", () => {
  it("waits for catalog and environment snapshots", () => {
    const projects = [project([{ id: WS }])];
    expect(
      resolveDeepLink(
        deepLinkInputFromParams({
          environmentId: ENV,
          workspaceId: WS,
          agentSessionId: AGENT,
        }),
        projects,
        { ...ENVIRONMENT_READY, catalogReady: false },
      ),
    ).toEqual({ state: "pending" });
    expect(
      resolveDeepLink(
        deepLinkInputFromParams({
          environmentId: ENV,
          workspaceId: WS,
          agentSessionId: AGENT,
        }),
        projects,
        { ...ENVIRONMENT_READY, environmentSnapshotPresent: false },
      ),
    ).toEqual({ state: "pending" });
  });

  it("reports unknown, disabled, missing-workspace, and missing-session targets", () => {
    const projects = [project([{ id: WS }])];
    expect(
      resolveDeepLink(
        deepLinkInputFromParams({
          environmentId: "missing" as EnvironmentId,
          workspaceId: WS,
          agentSessionId: AGENT,
        }),
        projects,
        { ...ENVIRONMENT_READY, environmentExists: false },
      ),
    ).toEqual({ state: "missing", reason: "environment" });
    expect(
      resolveDeepLink(
        deepLinkInputFromParams({
          environmentId: ENV,
          workspaceId: "missing" as WorkspaceId,
          agentSessionId: AGENT,
        }),
        projects,
        ENVIRONMENT_READY,
      ),
    ).toEqual({ state: "missing", reason: "workspace" });
    expect(
      resolveDeepLink(
        deepLinkInputFromParams({
          environmentId: ENV,
          workspaceId: WS,
          agentSessionId: AGENT,
        }),
        projects,
        ENVIRONMENT_READY,
      ),
    ).toEqual({ state: "missing", reason: "session" });
  });

  it("resolves active and history Agent and Terminal Sessions", () => {
    const projects = [
      project([
        {
          id: WS,
          sessions: [
            {
              kind: "agent",
              id: AGENT,
              workspaceId: WS,
              threadId: THREAD,
              title: "Agent",
              createdAt: "2026-01-01T00:00:00Z",
              updatedAt: "2026-01-01T00:00:00Z",
            },
            {
              kind: "terminal",
              id: TERMINAL,
              workspaceId: WS,
              title: "Terminal",
              createdAt: "2026-01-01T00:00:00Z",
              updatedAt: "2026-01-01T00:00:00Z",
            },
          ],
          historySessions: [
            {
              kind: "agent",
              id: "closed-agent" as AgentSessionId,
              workspaceId: WS,
              threadId: "closed-thread" as ThreadId,
              title: "Closed Agent",
              status: "closed",
              createdAt: "2026-01-01T00:00:00Z",
              updatedAt: "2026-01-01T00:00:00Z",
            },
          ],
        },
      ]),
    ];

    expect(
      resolveDeepLink(
        deepLinkInputFromParams({
          environmentId: ENV,
          workspaceId: WS,
          agentSessionId: AGENT,
        }),
        projects,
        ENVIRONMENT_READY,
      ),
    ).toMatchObject({ state: "ready", target: agentTarget });
    expect(
      resolveDeepLink(
        deepLinkInputFromParams({
          environmentId: ENV,
          workspaceId: WS,
          terminalSessionId: TERMINAL,
        }),
        projects,
        ENVIRONMENT_READY,
      ),
    ).toMatchObject({ state: "ready", target: terminalTarget });
    expect(
      resolveDeepLink(
        deepLinkInputFromParams({
          environmentId: ENV,
          workspaceId: WS,
          agentSessionId: "closed-agent" as AgentSessionId,
        }),
        projects,
        ENVIRONMENT_READY,
      ),
    ).toMatchObject({ state: "ready", target: { agentSessionId: "closed-agent" } });
  });

  it("resolves legacy Thread links to canonical Agent Session routes", () => {
    const projects = [
      project([
        {
          id: WS,
          historySessions: [
            {
              kind: "agent",
              id: AGENT,
              workspaceId: WS,
              threadId: THREAD,
              title: "Closed Agent",
              status: "closed",
              createdAt: "2026-01-01T00:00:00Z",
              updatedAt: "2026-01-01T00:00:00Z",
            },
          ],
        },
      ]),
    ];

    expect(
      resolveDeepLink(deepLinkInputFromParams({ environmentId: ENV, threadId: THREAD }), projects, {
        ...ENVIRONMENT_READY,
        environmentSnapshotPresent: false,
      }),
    ).toEqual({ state: "pending" });
    expect(
      resolveDeepLink(
        deepLinkInputFromParams({ environmentId: ENV, threadId: THREAD }),
        projects,
        ENVIRONMENT_READY,
      ),
    ).toMatchObject({
      state: "ready",
      legacy: true,
      target: agentTarget,
      canonicalRoute: sessionRouteForTarget(agentTarget),
    });
    expect(
      resolveDeepLink(
        deepLinkInputFromParams({ environmentId: ENV, threadId: "missing" as ThreadId }),
        projects,
        ENVIRONMENT_READY,
      ),
    ).toEqual({ state: "missing", reason: "session" });
  });
});
