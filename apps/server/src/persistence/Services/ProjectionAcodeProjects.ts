import {
  AcodeAgentSessionShell,
  AcodeProjectId,
  AcodeProjectShell,
  AcodeSessionShell,
  AcodeWorkspaceShell,
  AgentSessionId,
  ProjectId,
  ThreadId,
  WorkspaceId,
  WorkspaceOrigin,
  WorkspaceRole,
  IsoDateTime,
  TrimmedNonEmptyString,
} from "@t3tools/contracts";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";
import type { ProjectionRepositoryError } from "../Errors.ts";

export const ProjectionAcodeProjectRow = Schema.Struct({
  acodeProjectId: AcodeProjectId,
  projectTitle: TrimmedNonEmptyString,
  projectCreatedAt: IsoDateTime,
  projectUpdatedAt: IsoDateTime,
  workspaceId: WorkspaceId,
  t3ProjectId: ProjectId,
  workspaceTitle: TrimmedNonEmptyString,
  workspaceRoot: TrimmedNonEmptyString,
  workspaceRole: WorkspaceRole,
  workspaceOrigin: Schema.NullOr(WorkspaceOrigin),
  workspaceCreatedAt: IsoDateTime,
  workspaceUpdatedAt: IsoDateTime,
});
export type ProjectionAcodeProjectRow = typeof ProjectionAcodeProjectRow.Type;

export const ProjectionAcodeAgentSessionRow = Schema.Struct({
  agentSessionId: AgentSessionId,
  workspaceId: WorkspaceId,
  t3ProjectId: ProjectId,
  threadId: ThreadId,
  title: TrimmedNonEmptyString,
  createdAt: IsoDateTime,
  updatedAt: IsoDateTime,
  archivedAt: Schema.NullOr(IsoDateTime),
  deletedAt: Schema.NullOr(IsoDateTime),
});
export type ProjectionAcodeAgentSessionRow = typeof ProjectionAcodeAgentSessionRow.Type;

export interface UpsertProjectionAcodeProjectInput {
  readonly t3ProjectId: ProjectId;
  readonly title: string;
  readonly workspaceRoot: string;
  readonly createdAt: string;
  readonly updatedAt: string;
  /**
   * Attach the Workspace to this existing ACode Project instead of deriving a
   * fresh `acode-project:<t3ProjectId>` Project. Set by the workspace
   * management flows; absent for legacy project registration.
   */
  readonly acodeProjectId?: AcodeProjectId;
  /** Defaults to "main" when the Workspace is not attached to another Project. */
  readonly role?: WorkspaceRole;
  /** Only meaningful for attached "worktree" Workspaces; persisted as NULL otherwise. */
  readonly origin?: WorkspaceOrigin;
}

export interface UpsertProjectionAcodeAgentSessionInput {
  readonly agentSessionId: AgentSessionId;
  readonly t3ProjectId: ProjectId;
  readonly threadId: ThreadId;
  readonly title: string;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface UpdateProjectionAcodeAgentSessionInput {
  readonly threadId: ThreadId;
  readonly title?: string;
  readonly updatedAt: string;
}

export interface ProjectionAcodeProjectRepositoryShape {
  /** Upsert the ACode Project and its main Workspace mapping for a T3 project. */
  readonly upsertForT3Project: (
    input: UpsertProjectionAcodeProjectInput,
  ) => Effect.Effect<void, ProjectionRepositoryError>;
  /** Create or restore the stable ACode session bound to a T3 thread. */
  readonly upsertAgentSession: (
    input: UpsertProjectionAcodeAgentSessionInput,
  ) => Effect.Effect<void, ProjectionRepositoryError>;
  /** Update session metadata without changing its ACode identity or binding. */
  readonly updateAgentSession: (
    input: UpdateProjectionAcodeAgentSessionInput,
  ) => Effect.Effect<void, ProjectionRepositoryError>;
  readonly archiveAgentSession: (input: {
    readonly threadId: ThreadId;
    readonly archivedAt: string;
    readonly updatedAt: string;
  }) => Effect.Effect<void, ProjectionRepositoryError>;
  readonly unarchiveAgentSession: (input: {
    readonly threadId: ThreadId;
    readonly updatedAt: string;
  }) => Effect.Effect<void, ProjectionRepositoryError>;
  readonly deleteAgentSession: (input: {
    readonly threadId: ThreadId;
    readonly deletedAt: string;
  }) => Effect.Effect<void, ProjectionRepositoryError>;
  /** Remove the ACode mapping when its backing T3 project is deleted. */
  readonly removeForT3Project: (
    t3ProjectId: ProjectId,
  ) => Effect.Effect<void, ProjectionRepositoryError>;
  /** Change a Workspace display title without changing Project or checkout identity. */
  readonly updateWorkspaceTitle: (input: {
    readonly workspaceId: WorkspaceId;
    readonly title: string;
    readonly updatedAt: string;
  }) => Effect.Effect<void, ProjectionRepositoryError>;
  /** Read the complete active Project → Workspace tree. */
  readonly listTree: () => Effect.Effect<
    ReadonlyArray<AcodeProjectShell>,
    ProjectionRepositoryError
  >;
  /** Read one ACode Project with its Workspaces by its stable identity. */
  readonly getProjectById: (
    acodeProjectId: AcodeProjectId,
  ) => Effect.Effect<Option.Option<AcodeProjectShell>, ProjectionRepositoryError>;
  /** Read the tree row containing one T3 project for shell stream updates. */
  readonly getByT3ProjectId: (
    t3ProjectId: ProjectId,
  ) => Effect.Effect<Option.Option<AcodeProjectShell>, ProjectionRepositoryError>;
  /** Read the ACode Workspace owning a stable WorkspaceId. */
  readonly getWorkspaceById: (
    workspaceId: WorkspaceId,
  ) => Effect.Effect<Option.Option<AcodeWorkspaceShell>, ProjectionRepositoryError>;
  /** Read the owning ACode tree even after a session leaves the active shell. */
  readonly getByThreadId: (
    threadId: ThreadId,
  ) => Effect.Effect<Option.Option<AcodeProjectShell>, ProjectionRepositoryError>;
  /** Read a durable session binding regardless of active/archive shell state. */
  readonly getAgentSessionByThreadId: (
    threadId: ThreadId,
  ) => Effect.Effect<Option.Option<AcodeAgentSessionShell>, ProjectionRepositoryError>;
}

export class ProjectionAcodeProjectRepository extends Context.Service<
  ProjectionAcodeProjectRepository,
  ProjectionAcodeProjectRepositoryShape
>()("t3/persistence/Services/ProjectionAcodeProjects/ProjectionAcodeProjectRepository") {}

export function mapProjectionAcodeProjectRows(
  rows: ReadonlyArray<ProjectionAcodeProjectRow>,
  sessionRows: ReadonlyArray<ProjectionAcodeAgentSessionRow> = [],
): ReadonlyArray<AcodeProjectShell> {
  const activeSessionsByWorkspace = new Map<WorkspaceId, ReadonlyArray<AcodeSessionShell>>();
  const historySessionsByWorkspace = new Map<WorkspaceId, ReadonlyArray<AcodeSessionShell>>();
  for (const row of sessionRows) {
    if (row.deletedAt !== null) continue;
    const isClosed = row.archivedAt !== null;
    const session: AcodeAgentSessionShell = {
      kind: "agent",
      id: row.agentSessionId,
      workspaceId: row.workspaceId,
      threadId: row.threadId,
      title: row.title,
      status: isClosed ? "closed" : "open",
      ...(isClosed ? { closedAt: row.archivedAt } : {}),
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    };
    if (isClosed) {
      historySessionsByWorkspace.set(row.workspaceId, [
        ...(historySessionsByWorkspace.get(row.workspaceId) ?? []),
        session,
      ]);
    } else {
      activeSessionsByWorkspace.set(row.workspaceId, [
        ...(activeSessionsByWorkspace.get(row.workspaceId) ?? []),
        session,
      ]);
    }
  }

  const workspaces = new Map<WorkspaceId, AcodeWorkspaceShell>();
  for (const row of rows) {
    workspaces.set(row.workspaceId, {
      id: row.workspaceId,
      projectId: row.acodeProjectId,
      t3ProjectId: row.t3ProjectId,
      title: row.workspaceTitle,
      workspaceRoot: row.workspaceRoot,
      role: row.workspaceRole,
      ...(row.workspaceOrigin !== null ? { origin: row.workspaceOrigin } : {}),
      sessions: activeSessionsByWorkspace.get(row.workspaceId) ?? [],
      historySessions: historySessionsByWorkspace.get(row.workspaceId) ?? [],
      createdAt: row.workspaceCreatedAt,
      updatedAt: row.workspaceUpdatedAt,
    });
  }

  const projects = new Map<AcodeProjectId, AcodeProjectShell>();
  for (const row of rows) {
    const workspace = workspaces.get(row.workspaceId);
    if (workspace === undefined) continue;
    const latestSessionUpdatedAt = (workspace.sessions ?? []).reduce(
      (latest, session) => (session.updatedAt > latest ? session.updatedAt : latest),
      row.projectUpdatedAt,
    );
    const existing = projects.get(row.acodeProjectId);
    if (existing === undefined) {
      projects.set(row.acodeProjectId, {
        id: row.acodeProjectId,
        title: row.projectTitle,
        workspaces: [workspace],
        createdAt: row.projectCreatedAt,
        updatedAt:
          row.projectUpdatedAt > latestSessionUpdatedAt
            ? row.projectUpdatedAt
            : latestSessionUpdatedAt,
      });
      continue;
    }
    projects.set(row.acodeProjectId, {
      ...existing,
      title: row.projectTitle,
      workspaces: existing.workspaces.some((candidate) => candidate.id === workspace.id)
        ? existing.workspaces.map((candidate) =>
            candidate.id === workspace.id ? workspace : candidate,
          )
        : [...existing.workspaces, workspace],
      updatedAt:
        existing.updatedAt > latestSessionUpdatedAt ? existing.updatedAt : latestSessionUpdatedAt,
    });
  }
  return [...projects.values()];
}
