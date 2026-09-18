import * as Schema from "effect/Schema";

import {
  AcodeProjectId,
  IsoDateTime,
  ProjectId,
  TrimmedNonEmptyString,
  WorkspaceId,
} from "./baseSchemas.ts";

/** The first registered checkout role. Worktree roles are added by C07. */
export const WorkspaceRole = Schema.Literal("main");
export type WorkspaceRole = typeof WorkspaceRole.Type;

/** A stable checkout owned by one ACode Project. */
export const AcodeWorkspaceShell = Schema.Struct({
  id: WorkspaceId,
  projectId: AcodeProjectId,
  /** The T3 orchestration project that owns the execution directory. */
  t3ProjectId: ProjectId,
  title: TrimmedNonEmptyString,
  workspaceRoot: TrimmedNonEmptyString,
  role: WorkspaceRole,
  createdAt: IsoDateTime,
  updatedAt: IsoDateTime,
});
export type AcodeWorkspaceShell = typeof AcodeWorkspaceShell.Type;

/** A navigation Project grouping one or more ACode Workspaces. */
export const AcodeProjectShell = Schema.Struct({
  id: AcodeProjectId,
  title: TrimmedNonEmptyString,
  workspaces: Schema.Array(AcodeWorkspaceShell),
  createdAt: IsoDateTime,
  updatedAt: IsoDateTime,
});
export type AcodeProjectShell = typeof AcodeProjectShell.Type;

/**
 * Stable fallback identities for legacy project.create callers. The mapping
 * is deterministic but still keeps the ACode and T3 identifiers distinct.
 */
export function acodeProjectIdForT3Project(projectId: ProjectId): AcodeProjectId {
  return AcodeProjectId.make(`acode-project:${projectId}`);
}

export function workspaceIdForT3Project(projectId: ProjectId): WorkspaceId {
  return WorkspaceId.make(`workspace:${projectId}`);
}
