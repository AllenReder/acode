import { WorkspaceId } from "./baseSchemas.ts";
import { terminalSessionIdForRuntime } from "./session.ts";
import type { TerminalSummary } from "./terminal.ts";
import type { AcodeProjectShell, AcodeTerminalSessionShell } from "./workspace.ts";

/**
 * Join the terminal metadata projection to the durable Workspace tree. The
 * metadata stream is authoritative for terminals; orchestration owns Agents.
 * Legacy thread terminals cannot be assigned a Workspace by guessing a cwd.
 */
export function projectTerminalSessions(
  projects: ReadonlyArray<AcodeProjectShell>,
  terminals: ReadonlyArray<TerminalSummary>,
): ReadonlyArray<AcodeProjectShell> {
  const activeSessions = new Map<WorkspaceId, Map<string, AcodeTerminalSessionShell>>();
  const historySessions = new Map<WorkspaceId, Map<string, AcodeTerminalSessionShell>>();

  for (const terminal of terminals) {
    if (terminal.workspaceId === undefined) continue;
    const workspaceId = WorkspaceId.make(terminal.workspaceId);
    const id = terminalSessionIdForRuntime(workspaceId, terminal.terminalId);
    const isClosed = terminal.status === "closed";
    const targetMap = isClosed ? historySessions : activeSessions;
    let group = targetMap.get(workspaceId);
    if (!group) {
      group = new Map();
      targetMap.set(workspaceId, group);
    }
    group.set(id, {
      kind: "terminal",
      id,
      workspaceId,
      title: (terminal.title ?? terminal.label).trim() || "Terminal",
      status: isClosed ? "closed" : "open",
      ...(isClosed ? { closedAt: terminal.updatedAt } : {}),
      createdAt: terminal.createdAt ?? terminal.updatedAt,
      updatedAt: terminal.updatedAt,
    });
  }
  return projects.map((project) => ({
    ...project,
    workspaces: project.workspaces.map((workspace) => ({
      ...workspace,
      sessions: [
        ...(workspace.sessions ?? []).filter((session) => session.kind !== "terminal"),
        ...(activeSessions.get(workspace.id)?.values() ?? []),
      ],
      historySessions: [
        ...(workspace.historySessions ?? []).filter((session) => session.kind !== "terminal"),
        ...(historySessions.get(workspace.id)?.values() ?? []),
      ],
    })),
  }));
}
