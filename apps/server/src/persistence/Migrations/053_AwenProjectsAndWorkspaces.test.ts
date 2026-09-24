import { assert, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as SqlClient from "effect/unstable/sql/SqlClient";

import * as NodeSqliteClient from "@awen/shared/nodeSqliteClient";
import { runMigrations } from "../Migrations.ts";

const layer = it.layer(Layer.mergeAll(NodeSqliteClient.layerMemory()));

layer("053_AwenProjectsAndWorkspaces", (it) => {
  it.effect("backfills active Awen projects into distinct Awen identities", () =>
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
      const timestamp = "2026-09-18T00:00:00.000Z";

      yield* runMigrations({ toMigrationInclusive: 52 });
      yield* sql`
        INSERT INTO projection_projects (
          project_id, title, workspace_root, scripts_json, created_at, updated_at, deleted_at
        ) VALUES
          ('project-live', 'Live', '/srv/live', '[]', ${timestamp}, ${timestamp}, NULL),
          ('project-deleted', 'Deleted', '/srv/deleted', '[]', ${timestamp}, ${timestamp}, ${timestamp})
      `;

      yield* runMigrations({ toMigrationInclusive: 53 });

      const rows = yield* sql<{
        readonly awenProjectId: string;
        readonly workspaceId: string;
        readonly projectId: string;
        readonly workspaceRoot: string;
      }>`
        SELECT
          projects.awen_project_id AS "awenProjectId",
          workspaces.workspace_id AS "workspaceId",
          workspaces.project_id AS "projectId",
          workspaces.workspace_root AS "workspaceRoot"
        FROM projection_awen_projects AS projects
        INNER JOIN projection_awen_workspaces AS workspaces
          ON workspaces.awen_project_id = projects.awen_project_id
      `;

      assert.deepEqual(rows, [
        {
          awenProjectId: "awen-project:project-live",
          workspaceId: "workspace:project-live",
          projectId: "project-live",
          workspaceRoot: "/srv/live",
        },
      ]);
    }),
  );
});
