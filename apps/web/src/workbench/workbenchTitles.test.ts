import { describe, expect, it } from "vite-plus/test";
import type {
  AcodeProjectId,
  AgentSessionId,
  EnvironmentId,
  TerminalSessionId,
  WorkspaceId,
} from "@t3tools/contracts";

import type { EnvironmentAcodeProject } from "@t3tools/client-runtime/state/models";
import type { ViewTarget } from "./viewRegistry";
import {
  resolveTargetBreadcrumbs,
  resolveTargetContext,
  resolveTargetTitle,
} from "./workbenchTitles";

const environmentId = "env-a" as EnvironmentId;
const workspaceId = "ws-a" as WorkspaceId;
const projectId = "project-a" as AcodeProjectId;
const agentSessionId = "agent-a" as AgentSessionId;
const terminalSessionId = "terminal-a" as TerminalSessionId;
const now = "2026-09-20T00:00:00.000Z";
const agentTarget = {
  kind: "agentSession",
  environmentId,
  workspaceId,
  agentSessionId,
} satisfies ViewTarget;

const projects: ReadonlyArray<EnvironmentAcodeProject> = [
  {
    id: projectId,
    environmentId,
    title: "ACode",
    createdAt: now,
    updatedAt: now,
    workspaces: [
      {
        id: workspaceId,
        projectId,
        t3ProjectId: "t3-project-a" as never,
        title: "Main checkout",
        workspaceRoot: "/workspace",
        role: "main",
        createdAt: now,
        updatedAt: now,
        sessions: [
          {
            kind: "agent",
            id: agentSessionId,
            workspaceId,
            title: "Implement tabs",
            status: "open",
            createdAt: now,
            updatedAt: now,
            threadId: "thread-a" as never,
          },
          {
            kind: "terminal",
            id: terminalSessionId,
            workspaceId,
            title: "Dev server",
            status: "open",
            createdAt: now,
            updatedAt: now,
          },
        ],
      },
    ],
  },
];

describe("resolveTargetTitle", () => {
  it.each([
    [{ kind: "workspace", environmentId, workspaceId } satisfies ViewTarget, "Main checkout"],
    [{ kind: "project", environmentId, projectId } satisfies ViewTarget, "ACode"],
    [agentTarget, "Implement tabs"],
    [
      {
        kind: "workspaceTerminal",
        environmentId,
        workspaceId,
        terminalSessionId,
      } satisfies ViewTarget,
      "Dev server",
    ],
  ])("uses projected titles for %#", (target, expected) => {
    expect(resolveTargetTitle(target, projects)).toBe(expected);
  });

  it("resolves titles and breadcrumbs for workspace fileView", () => {
    const fileViewTarget = {
      kind: "workspace",
      definitionId: "fileView",
      environmentId,
      workspaceId,
    } satisfies ViewTarget;

    expect(resolveTargetTitle(fileViewTarget, projects)).toBe("Main checkout: Files");
    expect(resolveTargetBreadcrumbs(fileViewTarget, projects)).toEqual([
      "ACode",
      "Main checkout",
      "Files",
    ]);
  });

  it("uses a stable fallback when the target is offline or not present", () => {
    expect(
      resolveTargetTitle(
        {
          kind: "agentSession",
          environmentId,
          workspaceId,
          agentSessionId: "missing" as AgentSessionId,
        },
        projects,
      ),
    ).toBe("Agent");
  });

  it("resolves the Workspace context separately from the View title", () => {
    expect(resolveTargetContext(agentTarget, projects)).toBe("Main checkout");
  });

  it("builds Project, Workspace, and View breadcrumbs for Session Panes", () => {
    expect(resolveTargetBreadcrumbs(agentTarget, projects)).toEqual([
      "ACode",
      "Main checkout",
      "Implement tabs",
    ]);
    expect(
      resolveTargetBreadcrumbs(
        {
          kind: "workspaceTerminal",
          environmentId,
          workspaceId,
          terminalSessionId,
        } satisfies ViewTarget,
        projects,
      ),
    ).toEqual(["ACode", "Main checkout", "Dev server"]);
  });

  it("keeps stable breadcrumb fallbacks while a target is offline", () => {
    expect(
      resolveTargetBreadcrumbs(
        {
          kind: "agentSession",
          environmentId,
          workspaceId,
          agentSessionId: "missing" as AgentSessionId,
        },
        projects,
      ),
    ).toEqual(["ACode", "Main checkout", "Agent"]);
    expect(resolveTargetBreadcrumbs({ kind: "welcome" }, projects)).toEqual(["Welcome"]);
  });
});
