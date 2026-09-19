import { WelcomeView } from "./WelcomeView";
import { WorkspaceView } from "./WorkspaceView";
import { targetKey } from "./viewRegistry";
import type { ViewCapability, ViewDataSource, ViewDefinition, ViewTarget } from "./viewRegistry";

export type WorkspaceTarget = Extract<ViewTarget, { kind: "workspace" }>;
export type SessionTarget = Extract<ViewTarget, { kind: "agentSession" | "workspaceTerminal" }>;
export interface WorkspaceSummary {
  readonly target: WorkspaceTarget;
  readonly title: string;
  readonly projectTitle: string;
  readonly sessions: ReadonlyArray<{ readonly title: string; readonly target: SessionTarget }>;
}
export type WelcomeData = ReadonlyArray<WorkspaceSummary>;
export interface WelcomeCapabilities {
  readonly openWorkspace: ViewCapability<WorkspaceTarget, boolean>;
}
export interface WorkspaceCapabilities {
  readonly openSession: ViewCapability<SessionTarget, boolean>;
}

/** Host-owned grants revalidate against the latest snapshot on every invocation. */
export function createWorkspaceViewDefinitions(
  source: ViewDataSource<WelcomeData>,
  openTarget: (target: ViewTarget) => void,
): {
  welcome: ViewDefinition<
    Extract<ViewTarget, { kind: "welcome" }>,
    WelcomeData,
    WelcomeCapabilities
  >;
  workspace: ViewDefinition<WorkspaceTarget, WorkspaceSummary | null, WorkspaceCapabilities>;
} {
  const findWorkspace = (target: WorkspaceTarget) =>
    source
      .getSnapshot()
      .find(
        (workspace) =>
          workspace.target.environmentId === target.environmentId &&
          workspace.target.workspaceId === target.workspaceId,
      ) ?? null;
  return {
    welcome: {
      id: "welcome",
      label: "Welcome",
      accepts: (target): target is Extract<ViewTarget, { kind: "welcome" }> =>
        target.kind === "welcome",
      bind: () => ({
        dataSource: source,
        capabilities: {
          openWorkspace: {
            execute: (target) => {
              const workspace = findWorkspace(target);
              if (!workspace) return false;
              openTarget(workspace.target);
              return true;
            },
          },
        },
      }),
      Component: WelcomeView,
    },
    workspace: {
      id: "workspace",
      label: "Workspace",
      accepts: (target): target is WorkspaceTarget => target.kind === "workspace",
      bind: (target) => ({
        dataSource: { getSnapshot: () => findWorkspace(target), subscribe: source.subscribe },
        capabilities: {
          openSession: {
            execute: (requested) => {
              const session = findWorkspace(target)?.sessions.find(
                ({ target: candidate }) => targetKey(candidate) === targetKey(requested),
              );
              if (!session) return false;
              openTarget(session.target);
              return true;
            },
          },
        },
      }),
      Component: WorkspaceView,
    },
  };
}
