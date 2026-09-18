import { assert, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as SqlClient from "effect/unstable/sql/SqlClient";

import * as NodeSqliteClient from "@t3tools/shared/nodeSqliteClient";
import { runMigrations } from "../Migrations.ts";

const layer = it.layer(Layer.mergeAll(NodeSqliteClient.layerMemory()));

layer("053_AcodeProjectsAndWorkspaces", (it) => {
  it.effect("backfills active T3 projects into distinct ACode identities", () =>
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
        readonly acodeProjectId: string;
        readonly workspaceId: string;
        readonly t3ProjectId: string;
        readonly workspaceRoot: string;
      }>`
        SELECT
          projects.acode_project_id AS "acodeProjectId",
          workspaces.workspace_id AS "workspaceId",
          workspaces.t3_project_id AS "t3ProjectId",
          workspaces.workspace_root AS "workspaceRoot"
        FROM projection_acode_projects AS projects
        INNER JOIN projection_acode_workspaces AS workspaces
          ON workspaces.acode_project_id = projects.acode_project_id
      `;

      assert.deepEqual(rows, [
        {
          acodeProjectId: "acode-project:project-live",
          workspaceId: "workspace:project-live",
          t3ProjectId: "project-live",
          workspaceRoot: "/srv/live",
        },
      ]);
    }),
  );
});
