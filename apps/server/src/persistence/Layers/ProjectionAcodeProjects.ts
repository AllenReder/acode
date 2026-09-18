import { acodeProjectIdForT3Project, ProjectId, workspaceIdForT3Project } from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";
import * as SqlClient from "effect/unstable/sql/SqlClient";
import * as SqlSchema from "effect/unstable/sql/SqlSchema";

import { toPersistenceSqlError } from "../Errors.ts";
import {
  mapProjectionAcodeProjectRows,
  ProjectionAcodeProjectRepository,
  ProjectionAcodeProjectRow,
  type ProjectionAcodeProjectRepositoryShape,
} from "../Services/ProjectionAcodeProjects.ts";

const T3ProjectIdInput = Schema.Struct({ t3ProjectId: ProjectId });

const makeRepository = Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;

  const upsert: ProjectionAcodeProjectRepositoryShape["upsertForT3Project"] = (input) =>
    Effect.gen(function* () {
      const projectId = acodeProjectIdForT3Project(input.t3ProjectId);
      const workspaceId = workspaceIdForT3Project(input.t3ProjectId);
      yield* sql.withTransaction(
        Effect.gen(function* () {
          yield* sql`
          INSERT INTO projection_acode_projects (
            acode_project_id, title, created_at, updated_at
          ) VALUES (
            ${projectId}, ${input.title}, ${input.createdAt}, ${input.updatedAt}
          )
          ON CONFLICT (acode_project_id)
          DO UPDATE SET
            title = excluded.title,
            updated_at = excluded.updated_at
        `;
          yield* sql`
          INSERT INTO projection_acode_workspaces (
            workspace_id,
            acode_project_id,
            t3_project_id,
            title,
            workspace_root,
            role,
            created_at,
            updated_at
          ) VALUES (
            ${workspaceId}, ${projectId}, ${input.t3ProjectId}, ${input.title},
            ${input.workspaceRoot}, 'main', ${input.createdAt}, ${input.updatedAt}
          )
          ON CONFLICT (t3_project_id)
          DO UPDATE SET
            acode_project_id = excluded.acode_project_id,
            title = excluded.title,
            workspace_root = excluded.workspace_root,
            role = excluded.role,
            updated_at = excluded.updated_at
        `;
        }),
      );
    }).pipe(Effect.mapError(toPersistenceSqlError("ProjectionAcodeProjectRepository.upsert")));

  const getRows = SqlSchema.findAll({
    Request: Schema.Void,
    Result: ProjectionAcodeProjectRow,
    execute: () => sql`
      SELECT
        projects.acode_project_id AS "acodeProjectId",
        projects.title AS "projectTitle",
        projects.created_at AS "projectCreatedAt",
        projects.updated_at AS "projectUpdatedAt",
        workspaces.workspace_id AS "workspaceId",
        workspaces.t3_project_id AS "t3ProjectId",
        workspaces.title AS "workspaceTitle",
        workspaces.workspace_root AS "workspaceRoot",
        workspaces.role AS "workspaceRole",
        workspaces.created_at AS "workspaceCreatedAt",
        workspaces.updated_at AS "workspaceUpdatedAt"
      FROM projection_acode_projects AS projects
      INNER JOIN projection_acode_workspaces AS workspaces
        ON workspaces.acode_project_id = projects.acode_project_id
      ORDER BY projects.created_at ASC, projects.acode_project_id ASC,
        workspaces.created_at ASC, workspaces.workspace_id ASC
    `,
  });

  const getRowsForT3Project = SqlSchema.findAll({
    Request: T3ProjectIdInput,
    Result: ProjectionAcodeProjectRow,
    execute: ({ t3ProjectId }) => sql`
      SELECT
        projects.acode_project_id AS "acodeProjectId",
        projects.title AS "projectTitle",
        projects.created_at AS "projectCreatedAt",
        projects.updated_at AS "projectUpdatedAt",
        workspaces.workspace_id AS "workspaceId",
        workspaces.t3_project_id AS "t3ProjectId",
        workspaces.title AS "workspaceTitle",
        workspaces.workspace_root AS "workspaceRoot",
        workspaces.role AS "workspaceRole",
        workspaces.created_at AS "workspaceCreatedAt",
        workspaces.updated_at AS "workspaceUpdatedAt"
      FROM projection_acode_projects AS projects
      INNER JOIN projection_acode_workspaces AS workspaces
        ON workspaces.acode_project_id = projects.acode_project_id
      WHERE workspaces.t3_project_id = ${t3ProjectId}
      LIMIT 1
    `,
  });

  const remove: ProjectionAcodeProjectRepositoryShape["removeForT3Project"] = (t3ProjectId) =>
    Effect.gen(function* () {
      const projectId = acodeProjectIdForT3Project(t3ProjectId);
      yield* sql.withTransaction(
        Effect.gen(function* () {
          yield* sql`
          DELETE FROM projection_acode_workspaces
          WHERE t3_project_id = ${t3ProjectId}
        `;
          yield* sql`
          DELETE FROM projection_acode_projects
          WHERE acode_project_id = ${projectId}
            AND NOT EXISTS (
              SELECT 1 FROM projection_acode_workspaces
              WHERE acode_project_id = ${projectId}
            )
        `;
        }),
      );
    }).pipe(Effect.mapError(toPersistenceSqlError("ProjectionAcodeProjectRepository.remove")));

  return {
    upsertForT3Project: upsert,
    removeForT3Project: remove,
    listTree: () =>
      getRows(undefined).pipe(
        Effect.map((rows) => mapProjectionAcodeProjectRows(rows)),
        Effect.mapError(toPersistenceSqlError("ProjectionAcodeProjectRepository.listTree")),
      ),
    getByT3ProjectId: (t3ProjectId) =>
      getRowsForT3Project({ t3ProjectId }).pipe(
        Effect.map((rows) => Option.fromNullishOr(mapProjectionAcodeProjectRows(rows)[0])),
        Effect.mapError(toPersistenceSqlError("ProjectionAcodeProjectRepository.getByT3ProjectId")),
      ),
  } satisfies ProjectionAcodeProjectRepositoryShape;
});

export const ProjectionAcodeProjectRepositoryLive = Layer.effect(
  ProjectionAcodeProjectRepository,
  makeRepository,
);
