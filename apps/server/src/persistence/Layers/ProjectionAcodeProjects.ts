import {
  AcodeProjectId,
  acodeProjectIdForT3Project,
  ProjectId,
  ThreadId,
  workspaceIdForT3Project,
  WorkspaceId,
} from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";
import * as SqlClient from "effect/unstable/sql/SqlClient";
import * as SqlSchema from "effect/unstable/sql/SqlSchema";

import { PersistenceSqlError, toPersistenceSqlError } from "../Errors.ts";
import {
  mapProjectionAcodeProjectRows,
  ProjectionAcodeProjectRepository,
  ProjectionAcodeAgentSessionRow,
  ProjectionAcodeProjectRow,
  type ProjectionAcodeProjectRepositoryShape,
} from "../Services/ProjectionAcodeProjects.ts";

const T3ProjectIdInput = Schema.Struct({ t3ProjectId: ProjectId });
const ThreadIdInput = Schema.Struct({ threadId: ThreadId });
const AcodeProjectIdInput = Schema.Struct({ acodeProjectId: AcodeProjectId });

const makeRepository = Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;

  const getWorkspaceForT3Project = SqlSchema.findOneOption({
    Request: T3ProjectIdInput,
    Result: Schema.Struct({ workspaceId: WorkspaceId, acodeProjectId: AcodeProjectId }),
    execute: ({ t3ProjectId }) => sql`
      SELECT workspace_id AS "workspaceId", acode_project_id AS "acodeProjectId"
      FROM projection_acode_workspaces
      WHERE t3_project_id = ${t3ProjectId}
      LIMIT 1
    `,
  });

  const upsert: ProjectionAcodeProjectRepositoryShape["upsertForT3Project"] = (input) =>
    Effect.gen(function* () {
      const attached = input.acodeProjectId !== undefined;
      const projectId = input.acodeProjectId ?? acodeProjectIdForT3Project(input.t3ProjectId);
      const workspaceId = workspaceIdForT3Project(input.t3ProjectId);
      const role = input.role ?? "main";
      const origin = input.origin ?? null;
      yield* sql.withTransaction(
        Effect.gen(function* () {
          if (attached) {
            const target = yield* sql`
            SELECT acode_project_id
            FROM projection_acode_projects
            WHERE acode_project_id = ${projectId}
            LIMIT 1
          `;
            if (target.length === 0) {
              return yield* new PersistenceSqlError({
                operation: "ProjectionAcodeProjectRepository.upsert",
                detail: `No ACode Project '${projectId}' exists to attach T3 project '${input.t3ProjectId}' to.`,
              });
            }
          } else {
            // A meta update on a main checkout still renames its derived
            // Project. The same event on a Workspace attached elsewhere must
            // not materialize a shadow Project for its T3 project id.
            yield* sql`
            INSERT INTO projection_acode_projects (
              acode_project_id, title, created_at, updated_at
            )
            SELECT ${projectId}, ${input.title}, ${input.createdAt}, ${input.updatedAt}
            WHERE NOT EXISTS (
              SELECT 1 FROM projection_acode_workspaces
              WHERE t3_project_id = ${input.t3ProjectId}
                AND acode_project_id <> ${projectId}
            )
            ON CONFLICT (acode_project_id)
            DO UPDATE SET
              title = excluded.title,
              updated_at = excluded.updated_at
          `;
          }
          // Ownership, role, and origin are creation facts: a later event for
          // the same T3 project (meta update, replayed creation) refreshes the
          // display fields but must never re-parent or re-role the Workspace.
          yield* sql`
          INSERT INTO projection_acode_workspaces (
            workspace_id,
            acode_project_id,
            t3_project_id,
            title,
            workspace_root,
            role,
            origin,
            created_at,
            updated_at
          ) VALUES (
            ${workspaceId}, ${projectId}, ${input.t3ProjectId}, ${input.title},
            ${input.workspaceRoot}, ${role}, ${origin}, ${input.createdAt}, ${input.updatedAt}
          )
          ON CONFLICT (t3_project_id)
          DO UPDATE SET
            title = excluded.title,
            workspace_root = excluded.workspace_root,
            updated_at = excluded.updated_at
        `;
        }),
      );
    }).pipe(
      Effect.mapError((error) =>
        Schema.is(PersistenceSqlError)(error)
          ? error
          : toPersistenceSqlError("ProjectionAcodeProjectRepository.upsert")(error),
      ),
    );

  const upsertAgentSession: ProjectionAcodeProjectRepositoryShape["upsertAgentSession"] = (input) =>
    Effect.gen(function* () {
      const workspace = yield* getWorkspaceForT3Project({
        t3ProjectId: input.t3ProjectId,
      });
      if (Option.isNone(workspace)) {
        return yield* new PersistenceSqlError({
          operation: "ProjectionAcodeProjectRepository.upsertAgentSession",
          detail: `No ACode Workspace is bound to T3 project '${input.t3ProjectId}'.`,
        });
      }
      yield* sql`
        INSERT INTO projection_acode_agent_sessions (
          agent_session_id,
          workspace_id,
          t3_project_id,
          thread_id,
          title,
          created_at,
          updated_at,
          archived_at,
          deleted_at
        ) VALUES (
          ${input.agentSessionId},
          ${workspace.value.workspaceId},
          ${input.t3ProjectId},
          ${input.threadId},
          ${input.title},
          ${input.createdAt},
          ${input.updatedAt},
          NULL,
          NULL
        )
        ON CONFLICT (thread_id)
        DO UPDATE SET
          agent_session_id = excluded.agent_session_id,
          workspace_id = excluded.workspace_id,
          t3_project_id = excluded.t3_project_id,
          title = excluded.title,
          updated_at = excluded.updated_at,
          archived_at = NULL,
          deleted_at = NULL
      `;
    }).pipe(
      Effect.mapError((error) =>
        Schema.is(PersistenceSqlError)(error)
          ? error
          : toPersistenceSqlError("ProjectionAcodeProjectRepository.upsertAgentSession")(error),
      ),
    );

  const updateAgentSession: ProjectionAcodeProjectRepositoryShape["updateAgentSession"] = (input) =>
    sql`
      UPDATE projection_acode_agent_sessions
      SET
        title = COALESCE(${input.title ?? null}, title),
        updated_at = ${input.updatedAt}
      WHERE thread_id = ${input.threadId}
    `.pipe(
      Effect.mapError(toPersistenceSqlError("ProjectionAcodeProjectRepository.updateAgentSession")),
    );

  const archiveAgentSession: ProjectionAcodeProjectRepositoryShape["archiveAgentSession"] = (
    input,
  ) =>
    sql`
      UPDATE projection_acode_agent_sessions
      SET archived_at = ${input.archivedAt}, updated_at = ${input.updatedAt}
      WHERE thread_id = ${input.threadId}
    `.pipe(
      Effect.mapError(
        toPersistenceSqlError("ProjectionAcodeProjectRepository.archiveAgentSession"),
      ),
    );

  const unarchiveAgentSession: ProjectionAcodeProjectRepositoryShape["unarchiveAgentSession"] = (
    input,
  ) =>
    sql`
      UPDATE projection_acode_agent_sessions
      SET archived_at = NULL, deleted_at = NULL, updated_at = ${input.updatedAt}
      WHERE thread_id = ${input.threadId}
    `.pipe(
      Effect.mapError(
        toPersistenceSqlError("ProjectionAcodeProjectRepository.unarchiveAgentSession"),
      ),
    );

  const deleteAgentSession: ProjectionAcodeProjectRepositoryShape["deleteAgentSession"] = (input) =>
    sql`
      UPDATE projection_acode_agent_sessions
      SET deleted_at = ${input.deletedAt}, updated_at = ${input.deletedAt}
      WHERE thread_id = ${input.threadId}
    `.pipe(
      Effect.mapError(toPersistenceSqlError("ProjectionAcodeProjectRepository.deleteAgentSession")),
    );

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
        workspaces.origin AS "workspaceOrigin",
        workspaces.created_at AS "workspaceCreatedAt",
        workspaces.updated_at AS "workspaceUpdatedAt"
      FROM projection_acode_projects AS projects
      INNER JOIN projection_acode_workspaces AS workspaces
        ON workspaces.acode_project_id = projects.acode_project_id
      ORDER BY projects.created_at ASC, projects.acode_project_id ASC,
        workspaces.created_at ASC, workspaces.workspace_id ASC
    `,
  });

  const getRowsForAcodeProject = SqlSchema.findAll({
    Request: AcodeProjectIdInput,
    Result: ProjectionAcodeProjectRow,
    execute: ({ acodeProjectId }) => sql`
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
        workspaces.origin AS "workspaceOrigin",
        workspaces.created_at AS "workspaceCreatedAt",
        workspaces.updated_at AS "workspaceUpdatedAt"
      FROM projection_acode_projects AS projects
      INNER JOIN projection_acode_workspaces AS workspaces
        ON workspaces.acode_project_id = projects.acode_project_id
      WHERE projects.acode_project_id = ${acodeProjectId}
      ORDER BY workspaces.created_at ASC, workspaces.workspace_id ASC
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
        workspaces.origin AS "workspaceOrigin",
        workspaces.created_at AS "workspaceCreatedAt",
        workspaces.updated_at AS "workspaceUpdatedAt"
      FROM projection_acode_projects AS projects
      INNER JOIN projection_acode_workspaces AS workspaces
        ON workspaces.acode_project_id = projects.acode_project_id
      WHERE workspaces.t3_project_id = ${t3ProjectId}
      LIMIT 1
    `,
  });

  const getActiveSessionRows = SqlSchema.findAll({
    Request: Schema.Struct({ t3ProjectId: Schema.optional(ProjectId) }),
    Result: ProjectionAcodeAgentSessionRow,
    execute: ({ t3ProjectId }) => sql`
      SELECT
        sessions.agent_session_id AS "agentSessionId",
        sessions.workspace_id AS "workspaceId",
        sessions.t3_project_id AS "t3ProjectId",
        sessions.thread_id AS "threadId",
        sessions.title,
        sessions.created_at AS "createdAt",
        sessions.updated_at AS "updatedAt",
        sessions.archived_at AS "archivedAt",
        sessions.deleted_at AS "deletedAt"
      FROM projection_acode_agent_sessions AS sessions
      WHERE sessions.archived_at IS NULL
        AND sessions.deleted_at IS NULL
        AND (${t3ProjectId ?? null} IS NULL OR sessions.t3_project_id = ${t3ProjectId ?? null})
      ORDER BY sessions.created_at ASC, sessions.agent_session_id ASC
    `,
  });

  const getRowsForThread = SqlSchema.findAll({
    Request: ThreadIdInput,
    Result: ProjectionAcodeProjectRow,
    execute: ({ threadId }) => sql`
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
        workspaces.origin AS "workspaceOrigin",
        workspaces.created_at AS "workspaceCreatedAt",
        workspaces.updated_at AS "workspaceUpdatedAt"
      FROM projection_acode_agent_sessions AS sessions
      INNER JOIN projection_acode_workspaces AS workspaces
        ON workspaces.workspace_id = sessions.workspace_id
      INNER JOIN projection_acode_projects AS projects
        ON projects.acode_project_id = workspaces.acode_project_id
      WHERE sessions.thread_id = ${threadId}
      LIMIT 1
    `,
  });

  const getSessionRowForThread = SqlSchema.findOneOption({
    Request: ThreadIdInput,
    Result: ProjectionAcodeAgentSessionRow,
    execute: ({ threadId }) => sql`
      SELECT
        agent_session_id AS "agentSessionId",
        workspace_id AS "workspaceId",
        t3_project_id AS "t3ProjectId",
        thread_id AS "threadId",
        title,
        created_at AS "createdAt",
        updated_at AS "updatedAt",
        archived_at AS "archivedAt",
        deleted_at AS "deletedAt"
      FROM projection_acode_agent_sessions
      WHERE thread_id = ${threadId}
      LIMIT 1
    `,
  });

  const remove: ProjectionAcodeProjectRepositoryShape["removeForT3Project"] = (t3ProjectId) =>
    Effect.gen(function* () {
      // The owning Project is a creation fact on the workspace row, not a
      // derivation: attached Workspaces share their Project with siblings, so
      // the deterministic id would point at a Project that does not exist.
      const workspace = yield* getWorkspaceForT3Project({ t3ProjectId });
      yield* sql.withTransaction(
        Effect.gen(function* () {
          yield* sql`
          DELETE FROM projection_acode_agent_sessions
          WHERE t3_project_id = ${t3ProjectId}
        `;
          yield* sql`
          DELETE FROM projection_acode_workspaces
          WHERE t3_project_id = ${t3ProjectId}
        `;
          if (Option.isSome(workspace)) {
            const acodeProjectId = workspace.value.acodeProjectId;
            yield* sql`
            DELETE FROM projection_acode_projects
            WHERE acode_project_id = ${acodeProjectId}
              AND NOT EXISTS (
                SELECT 1 FROM projection_acode_workspaces
                WHERE acode_project_id = ${acodeProjectId}
              )
          `;
          }
        }),
      );
    }).pipe(Effect.mapError(toPersistenceSqlError("ProjectionAcodeProjectRepository.remove")));

  return {
    upsertForT3Project: upsert,
    upsertAgentSession,
    updateAgentSession,
    archiveAgentSession,
    unarchiveAgentSession,
    deleteAgentSession,
    removeForT3Project: remove,
    listTree: () =>
      Effect.all([getRows(undefined), getActiveSessionRows({})]).pipe(
        Effect.map(([rows, sessions]) => mapProjectionAcodeProjectRows(rows, sessions)),
        Effect.mapError(toPersistenceSqlError("ProjectionAcodeProjectRepository.listTree")),
      ),
    getProjectById: (acodeProjectId) =>
      Effect.all([getRowsForAcodeProject({ acodeProjectId }), getActiveSessionRows({})]).pipe(
        Effect.map(([rows, sessions]) =>
          Option.fromNullishOr(mapProjectionAcodeProjectRows(rows, sessions)[0]),
        ),
        Effect.mapError(toPersistenceSqlError("ProjectionAcodeProjectRepository.getProjectById")),
      ),
    getByT3ProjectId: (t3ProjectId) =>
      Effect.all([
        getRowsForT3Project({ t3ProjectId }),
        getActiveSessionRows({ t3ProjectId }),
      ]).pipe(
        Effect.map(([rows, sessions]) =>
          Option.fromNullishOr(mapProjectionAcodeProjectRows(rows, sessions)[0]),
        ),
        Effect.mapError(toPersistenceSqlError("ProjectionAcodeProjectRepository.getByT3ProjectId")),
      ),
    getWorkspaceById: (workspaceId) =>
      Effect.all([getRows(undefined), getActiveSessionRows({})]).pipe(
        Effect.map(([rows, sessions]) =>
          Option.fromNullishOr(
            mapProjectionAcodeProjectRows(rows, sessions)
              .flatMap((project) => project.workspaces)
              .find((workspace) => workspace.id === workspaceId),
          ),
        ),
        Effect.mapError(toPersistenceSqlError("ProjectionAcodeProjectRepository.getWorkspaceById")),
      ),
    getByThreadId: (threadId) =>
      Effect.gen(function* () {
        const rows = yield* getRowsForThread({ threadId });
        if (rows.length === 0) return Option.none();
        const sessions = yield* getActiveSessionRows({
          t3ProjectId: rows[0]!.t3ProjectId,
        });
        return Option.fromNullishOr(mapProjectionAcodeProjectRows(rows, sessions)[0]);
      }).pipe(
        Effect.mapError(toPersistenceSqlError("ProjectionAcodeProjectRepository.getByThreadId")),
      ),
    getAgentSessionByThreadId: (threadId) =>
      getSessionRowForThread({ threadId }).pipe(
        Effect.map(
          Option.map((row) => ({
            id: row.agentSessionId,
            workspaceId: row.workspaceId,
            threadId: row.threadId,
            title: row.title,
            createdAt: row.createdAt,
            updatedAt: row.updatedAt,
          })),
        ),
        Effect.mapError(
          toPersistenceSqlError("ProjectionAcodeProjectRepository.getAgentSessionByThreadId"),
        ),
      ),
  } satisfies ProjectionAcodeProjectRepositoryShape;
});

export const ProjectionAcodeProjectRepositoryLive = Layer.effect(
  ProjectionAcodeProjectRepository,
  makeRepository,
);
