import { describe, expect, it } from "vite-plus/test";

import type {
  AcodeProjectId,
  AgentSessionId,
  EnvironmentId,
  ProjectId,
  ThreadId,
  WorkspaceId,
} from "@t3tools/contracts";

import { urlParamsToTarget } from "./urlBridge";
import type { EnvironmentAcodeProject } from "@t3tools/client-runtime/state/models";

const ENV: EnvironmentId = "env-a" as EnvironmentId;
const WS: WorkspaceId = "ws-a" as WorkspaceId;
const AGENT: AgentSessionId = "agent-x" as AgentSessionId;
const THREAD: ThreadId = "thread-x" as ThreadId;
const PROJECT_ID: ProjectId = "project-a" as ProjectId;

function project(
  workspaces: ReadonlyArray<{
    readonly id: WorkspaceId;
    readonly sessions?: ReadonlyArray<{
      readonly id: AgentSessionId;
      readonly threadId: ThreadId;
    }>;
  }>,
): EnvironmentAcodeProject {
  return {
    id: PROJECT_ID as unknown as AcodeProjectId,
    environmentId: ENV,
    title: "Project A",
    workspaces: workspaces.map((workspace) => ({
      id: workspace.id,
      projectId: PROJECT_ID as unknown as AcodeProjectId,
      t3ProjectId: PROJECT_ID,
      title: "Workspace",
      workspaceRoot: "/tmp/a",
      role: "main" as const,
      sessions: workspace.sessions?.map((session) => ({
        kind: "agent" as const,
        id: session.id,
        workspaceId: workspace.id,
        threadId: session.threadId,
        title: "Session",
        createdAt: "2026-01-01T00:00:00Z",
        updatedAt: "2026-01-01T00:00:00Z",
      })),
      createdAt: "2026-01-01T00:00:00Z",
      updatedAt: "2026-01-01T00:00:00Z",
    })),
    createdAt: "2026-01-01T00:00:00Z",
    updatedAt: "2026-01-01T00:00:00Z",
  };
}

describe("urlParamsToTarget", () => {
  it("returns null when either parameter is missing", () => {
    expect(urlParamsToTarget(null, THREAD, [])).toBeNull();
    expect(urlParamsToTarget(ENV, null, [])).toBeNull();
    expect(urlParamsToTarget(null, null, [])).toBeNull();
  });

  it("returns the matching Agent Session target when a thread id is known", () => {
    const projects = [
      project([
        {
          id: WS,
          sessions: [{ id: AGENT, threadId: THREAD }],
        },
      ]),
    ];
    expect(urlParamsToTarget(ENV, THREAD, projects)).toEqual({
      kind: "agentSession",
      environmentId: ENV,
      workspaceId: WS,
      agentSessionId: AGENT,
    });
  });

  it("ignores workspaces that do not own the thread id", () => {
    const projects = [
      project([
        {
          id: WS,
          sessions: [{ id: AGENT, threadId: "thread-other" as ThreadId }],
        },
      ]),
    ];
    expect(urlParamsToTarget(ENV, THREAD, projects)).toBeNull();
  });

  it("scopes the search by environment id", () => {
    const projects = [
      {
        ...project([
          {
            id: WS,
            sessions: [{ id: AGENT, threadId: THREAD }],
          },
        ]),
        environmentId: "env-other" as EnvironmentId,
      },
    ];
    expect(urlParamsToTarget(ENV, THREAD, projects)).toBeNull();
  });
});