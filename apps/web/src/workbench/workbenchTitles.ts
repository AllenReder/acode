import type { EnvironmentAcodeProject } from "@t3tools/client-runtime/state/models";

import type { ViewTarget } from "./viewRegistry";

type WorkspaceScopedTarget = Extract<
  ViewTarget,
  { kind: "workspace" | "agentSession" | "newAgentSession" | "workspaceTerminal" }
>;

function workspaceFor(
  target: WorkspaceScopedTarget,
  projects: ReadonlyArray<EnvironmentAcodeProject>,
) {
  for (const project of projects) {
    if (project.environmentId !== target.environmentId) continue;
    const workspace = project.workspaces.find((candidate) => candidate.id === target.workspaceId);
    if (workspace !== undefined) return workspace;
  }
  return null;
}

export function resolveTargetContext(
  target: ViewTarget,
  projects: ReadonlyArray<EnvironmentAcodeProject>,
): string {
  if (target.kind === "welcome") return "Workbench";
  if (target.kind === "project") return "Project";
  return workspaceFor(target, projects)?.title ?? "Workspace";
}

export function fallbackTargetTitle(target: ViewTarget): string {
  switch (target.kind) {
    case "welcome":
      return "Welcome";
    case "project":
      return "Project";
    case "workspace":
      return "Workspace";
    case "agentSession":
      return "Agent";
    case "newAgentSession":
      return "New Agent Session";
    case "workspaceTerminal":
      return "Terminal";
  }
}

/** Resolve a human title from the latest public projection, never from runtime identity. */
export function resolveTargetTitle(
  target: ViewTarget,
  projects: ReadonlyArray<EnvironmentAcodeProject>,
): string {
  if (target.kind === "welcome") return "Welcome";
  if (target.kind === "project") {
    for (const project of projects) {
      if (project.environmentId === target.environmentId && project.id === target.projectId) {
        return project.title;
      }
    }
    return fallbackTargetTitle(target);
  }

  const workspace = workspaceFor(target, projects);
  if (workspace === null) {
    return fallbackTargetTitle(target);
  }

  switch (target.kind) {
    case "workspace":
      return workspace.title;
    case "newAgentSession":
      return "New Agent Session";
    case "agentSession":
      return (
        [...(workspace.sessions ?? []), ...(workspace.historySessions ?? [])].find(
          (session) => session.kind === "agent" && session.id === target.agentSessionId,
        )?.title ?? "Agent"
      );
    case "workspaceTerminal":
      return (
        [...(workspace.sessions ?? []), ...(workspace.historySessions ?? [])].find(
          (session) => session.kind === "terminal" && session.id === target.terminalSessionId,
        )?.title ?? "Terminal"
      );
  }
}
