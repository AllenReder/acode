import {
  AcodeProjectId,
  AcodeProjectShell,
  AcodeWorkspaceShell,
  ProjectId,
  WorkspaceId,
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
  workspaceCreatedAt: IsoDateTime,
  workspaceUpdatedAt: IsoDateTime,
});
export type ProjectionAcodeProjectRow = typeof ProjectionAcodeProjectRow.Type;

export interface UpsertProjectionAcodeProjectInput {
  readonly t3ProjectId: ProjectId;
  readonly title: string;
  readonly workspaceRoot: string;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface ProjectionAcodeProjectRepositoryShape {
  /** Upsert the ACode Project and its main Workspace mapping for a T3 project. */
  readonly upsertForT3Project: (
    input: UpsertProjectionAcodeProjectInput,
  ) => Effect.Effect<void, ProjectionRepositoryError>;
  /** Remove the ACode mapping when its backing T3 project is deleted. */
  readonly removeForT3Project: (
    t3ProjectId: ProjectId,
  ) => Effect.Effect<void, ProjectionRepositoryError>;
  /** Read the complete active Project → Workspace tree. */
  readonly listTree: () => Effect.Effect<
    ReadonlyArray<AcodeProjectShell>,
    ProjectionRepositoryError
  >;
  /** Read the tree row containing one T3 project for shell stream updates. */
  readonly getByT3ProjectId: (
    t3ProjectId: ProjectId,
  ) => Effect.Effect<Option.Option<AcodeProjectShell>, ProjectionRepositoryError>;
  /** Read the ACode Workspace owning a stable WorkspaceId. */
  readonly getWorkspaceById: (
    workspaceId: WorkspaceId,
  ) => Effect.Effect<Option.Option<AcodeWorkspaceShell>, ProjectionRepositoryError>;
}

export class ProjectionAcodeProjectRepository extends Context.Service<
  ProjectionAcodeProjectRepository,
  ProjectionAcodeProjectRepositoryShape
>()("t3/persistence/Services/ProjectionAcodeProjects/ProjectionAcodeProjectRepository") {}

export function mapProjectionAcodeProjectRows(
  rows: ReadonlyArray<ProjectionAcodeProjectRow>,
): ReadonlyArray<AcodeProjectShell> {
  const projects = new Map<AcodeProjectId, AcodeProjectShell>();
  for (const row of rows) {
    const workspace: AcodeWorkspaceShell = {
      id: row.workspaceId,
      projectId: row.acodeProjectId,
      t3ProjectId: row.t3ProjectId,
      title: row.workspaceTitle,
      workspaceRoot: row.workspaceRoot,
      role: row.workspaceRole,
      createdAt: row.workspaceCreatedAt,
      updatedAt: row.workspaceUpdatedAt,
    };
    const existing = projects.get(row.acodeProjectId);
    if (existing === undefined) {
      projects.set(row.acodeProjectId, {
        id: row.acodeProjectId,
        title: row.projectTitle,
        workspaces: [workspace],
        createdAt: row.projectCreatedAt,
        updatedAt: row.projectUpdatedAt,
      });
      continue;
    }
    projects.set(row.acodeProjectId, {
      ...existing,
      title: row.projectTitle,
      workspaces: [...existing.workspaces, workspace],
      updatedAt:
        existing.updatedAt > row.projectUpdatedAt ? existing.updatedAt : row.projectUpdatedAt,
    });
  }
  return [...projects.values()];
}
