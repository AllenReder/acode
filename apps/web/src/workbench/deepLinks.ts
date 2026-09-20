import {
  agentSessionsIn,
  type AgentSessionId,
  type EnvironmentId,
  type TerminalSessionId,
  type ThreadId,
  type WorkspaceId,
} from "@t3tools/contracts";
import type { EnvironmentAcodeProject } from "@t3tools/client-runtime/state/models";
import { normalizeProjectPathForComparison } from "@t3tools/shared/path";
import type { DraftId } from "../composerDraftStore";

import type { ViewTarget } from "./viewRegistry";

export type SessionTarget = Extract<ViewTarget, { kind: "agentSession" | "workspaceTerminal" }>;
export type NewAgentSessionTarget = Extract<ViewTarget, { kind: "newAgentSession" }>;

export type SessionRoutePath =
  | "/$environmentId/workspaces/$workspaceId/agent-sessions/$agentSessionId"
  | "/$environmentId/workspaces/$workspaceId/terminal-sessions/$terminalSessionId";

export interface SessionRouteLocation {
  readonly to: SessionRoutePath;
  readonly params: Readonly<Record<string, string>>;
}

export function draftIdFromParams(params: {
  readonly draftId?: string | undefined;
}): DraftId | null {
  return params.draftId === undefined || params.draftId.length === 0
    ? null
    : (params.draftId as DraftId);
}

export function newAgentSessionTargetForDraft(
  draftId: DraftId,
  draft: { readonly environmentId: EnvironmentId; readonly workspaceId: WorkspaceId },
): NewAgentSessionTarget {
  return {
    kind: "newAgentSession",
    environmentId: draft.environmentId,
    workspaceId: draft.workspaceId,
    draftId,
  };
}

export function resolveNewAgentSessionTarget(
  draftId: DraftId,
  draft: {
    readonly environmentId: EnvironmentId;
    readonly workspaceId: WorkspaceId;
    readonly worktreePath?: string | null | undefined;
  },
  projects: ReadonlyArray<EnvironmentAcodeProject>,
): NewAgentSessionTarget | null {
  if (draft.worktreePath) {
    const normalizedCheckout = normalizeProjectPathForComparison(draft.worktreePath);
    for (const project of projects) {
      if (project.environmentId !== draft.environmentId) continue;
      const workspace = project.workspaces.find(
        (candidate) =>
          normalizeProjectPathForComparison(candidate.workspaceRoot) === normalizedCheckout,
      );
      if (workspace !== undefined) {
        return newAgentSessionTargetForDraft(draftId, {
          environmentId: draft.environmentId,
          workspaceId: workspace.id,
        });
      }
    }
  }

  const storedWorkspace = projects
    .find((project) => project.environmentId === draft.environmentId)
    ?.workspaces.find((workspace) => workspace.id === draft.workspaceId);
  return storedWorkspace === undefined
    ? null
    : newAgentSessionTargetForDraft(draftId, {
        environmentId: draft.environmentId,
        workspaceId: draft.workspaceId,
      });
}

export type DeepLinkRouteInput =
  | {
      readonly kind: "agentSession";
      readonly environmentId: EnvironmentId;
      readonly workspaceId: WorkspaceId;
      readonly agentSessionId: AgentSessionId;
    }
  | {
      readonly kind: "workspaceTerminal";
      readonly environmentId: EnvironmentId;
      readonly workspaceId: WorkspaceId;
      readonly terminalSessionId: TerminalSessionId;
    }
  | {
      readonly kind: "legacyThread";
      readonly environmentId: EnvironmentId;
      readonly threadId: ThreadId;
    };

export type DeepLinkResolution =
  | { readonly state: "idle" }
  | { readonly state: "pending" }
  | {
      readonly state: "ready";
      readonly target: SessionTarget;
      readonly canonicalRoute: SessionRouteLocation;
      readonly legacy: boolean;
    }
  | {
      readonly state: "missing";
      readonly reason: "environment" | "workspace" | "session";
    };

export interface DeepLinkEnvironmentState {
  readonly catalogReady: boolean;
  readonly environmentExists: boolean;
  readonly environmentEnabled: boolean;
  readonly environmentSnapshotPresent: boolean;
}

export function sessionRouteForTarget(target: SessionTarget): SessionRouteLocation {
  if (target.kind === "agentSession") {
    return {
      to: "/$environmentId/workspaces/$workspaceId/agent-sessions/$agentSessionId",
      params: {
        environmentId: target.environmentId,
        workspaceId: target.workspaceId,
        agentSessionId: target.agentSessionId,
      },
    };
  }
  return {
    to: "/$environmentId/workspaces/$workspaceId/terminal-sessions/$terminalSessionId",
    params: {
      environmentId: target.environmentId,
      workspaceId: target.workspaceId,
      terminalSessionId: target.terminalSessionId,
    },
  };
}

export function deepLinkInputFromParams(
  params: Partial<
    Record<
      | "environmentId"
      | "workspaceId"
      | "agentSessionId"
      | "terminalSessionId"
      | "threadId"
      | "draftId",
      string | undefined
    >
  >,
): DeepLinkRouteInput | null {
  if (params.environmentId === undefined) return null;
  const environmentId = params.environmentId as EnvironmentId;

  if (
    params.workspaceId !== undefined &&
    params.agentSessionId !== undefined &&
    params.terminalSessionId === undefined &&
    params.threadId === undefined
  ) {
    return {
      kind: "agentSession",
      environmentId,
      workspaceId: params.workspaceId as WorkspaceId,
      agentSessionId: params.agentSessionId as AgentSessionId,
    };
  }

  if (
    params.workspaceId !== undefined &&
    params.terminalSessionId !== undefined &&
    params.agentSessionId === undefined &&
    params.threadId === undefined
  ) {
    return {
      kind: "workspaceTerminal",
      environmentId,
      workspaceId: params.workspaceId as WorkspaceId,
      terminalSessionId: params.terminalSessionId as TerminalSessionId,
    };
  }

  if (params.threadId !== undefined) {
    return {
      kind: "legacyThread",
      environmentId,
      threadId: params.threadId as ThreadId,
    };
  }

  return null;
}

function pendingEnvironment(environment: DeepLinkEnvironmentState): DeepLinkResolution | null {
  if (!environment.catalogReady) return { state: "pending" };
  if (!environment.environmentExists || !environment.environmentEnabled) {
    return { state: "missing", reason: "environment" };
  }
  if (!environment.environmentSnapshotPresent) return { state: "pending" };
  return null;
}

function workspaceFor(
  projects: ReadonlyArray<EnvironmentAcodeProject>,
  environmentId: EnvironmentId,
  workspaceId: WorkspaceId,
) {
  for (const project of projects) {
    if (project.environmentId !== environmentId) continue;
    const workspace = project.workspaces.find((candidate) => candidate.id === workspaceId);
    if (workspace !== undefined) return workspace;
  }
  return null;
}

export function resolveDeepLink(
  input: DeepLinkRouteInput | null,
  projects: ReadonlyArray<EnvironmentAcodeProject>,
  environment: DeepLinkEnvironmentState,
): DeepLinkResolution {
  if (input === null) return { state: "idle" };

  const pending = pendingEnvironment(environment);
  if (pending !== null) return pending;

  if (input.kind === "legacyThread") {
    for (const project of projects) {
      if (project.environmentId !== input.environmentId) continue;
      for (const workspace of project.workspaces) {
        const session = agentSessionsIn(workspace).find(
          (candidate) => candidate.threadId === input.threadId,
        );
        if (session !== undefined) {
          const target: SessionTarget = {
            kind: "agentSession",
            environmentId: input.environmentId,
            workspaceId: workspace.id,
            agentSessionId: session.id,
          };
          return {
            state: "ready",
            target,
            canonicalRoute: sessionRouteForTarget(target),
            legacy: true,
          };
        }
      }
    }
    return { state: "missing", reason: "session" };
  }

  const workspace = workspaceFor(projects, input.environmentId, input.workspaceId);
  if (workspace === null) return { state: "missing", reason: "workspace" };

  if (input.kind === "agentSession") {
    const exists = agentSessionsIn(workspace).some(
      (session) => session.id === input.agentSessionId,
    );
    if (!exists) return { state: "missing", reason: "session" };
    return {
      state: "ready",
      target: input,
      canonicalRoute: sessionRouteForTarget(input),
      legacy: false,
    };
  }

  const terminalExists = [...(workspace.sessions ?? []), ...(workspace.historySessions ?? [])].some(
    (session) => session.kind === "terminal" && session.id === input.terminalSessionId,
  );
  if (!terminalExists) return { state: "missing", reason: "session" };
  return {
    state: "ready",
    target: input,
    canonicalRoute: sessionRouteForTarget(input),
    legacy: false,
  };
}
