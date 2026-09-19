import {
  activeAgentSessionsIn,
  agentSessionRefForShell,
  type AgentSessionId,
  type EnvironmentId,
  type ThreadId,
  type WorkspaceId,
} from "@t3tools/contracts";

import type { EnvironmentAcodeProject } from "@t3tools/client-runtime/state/models";

import type { ViewTarget } from "./viewRegistry";

/**
 * Translate a `(environmentId, threadId)` URL pair into a workbench target.
 *
 * C10 keeps `_chat/$environmentId/$threadId` as a deep-link entry (per the
 * C10 grill Q3): the thread id resolves to an ACode Agent Session, which
 * becomes an `agentSession` target that the workbench can either focus an
 * existing Pane of or bind to the focused Pane.
 *
 * The Thread→Agent Session lookup lives here, at the compatibility boundary:
 * the target is built from the canonical Agent Session reference, so the T3
 * thread id stops at this function instead of travelling into the Workbench.
 *
 * Drafts (`_chat.draft.$draftId`) are retired in this ticket — they are
 * promoted to server threads before they ever hit this bridge.
 *
 * Returns null when the URL does not resolve to a known Agent Session
 * (workspace is hydrating, thread is not owned by any Workspace yet, or
 * the URL is incomplete). The bridge re-runs whenever the ACode projects
 * snapshot changes, so a hydrating workspace is handled by re-running.
 */
export function urlParamsToTarget(
  environmentId: EnvironmentId | null,
  threadId: ThreadId | null,
  projects: ReadonlyArray<EnvironmentAcodeProject>,
): ViewTarget | null {
  if (environmentId === null || threadId === null) return null;
  for (const project of projects) {
    if (project.environmentId !== environmentId) continue;
    for (const workspace of project.workspaces) {
      const session = activeAgentSessionsIn(workspace).find(
        (candidate) => candidate.threadId === threadId,
      );
      if (session !== undefined) {
        const ref = agentSessionRefForShell(session);
        return {
          kind: "agentSession",
          environmentId,
          workspaceId: ref.workspaceId,
          agentSessionId: ref.agentSessionId,
        };
      }
    }
  }
  return null;
}

/** Narrowed result of `urlParamsToTarget` for agent sessions. */
export type AgentSessionTarget = Extract<ViewTarget, { kind: "agentSession" }>;

export type { WorkspaceId, AgentSessionId, EnvironmentId, ThreadId };
