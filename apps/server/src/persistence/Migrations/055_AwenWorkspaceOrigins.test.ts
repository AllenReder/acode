import { assert, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as SqlClient from "effect/unstable/sql/SqlClient";

import * as NodeSqliteClient from "@awen/shared/nodeSqliteClient";
import { runMigrations } from "../Migrations.ts";

const layer = it.layer(Layer.mergeAll(NodeSqliteClient.layerMemory()));

layer("055_AwenWorkspaceOrigins", (it) => {
  it.effect("adds a nullable origin column and keeps existing rows as main registrations", () =>
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
      const timestamp = "2026-09-18T00:00:00.000Z";

      yield* runMigrations({ toMigrationInclusive: 54 });
      yield* sql`
        INSERT INTO projection_awen_projects (
          awen_project_id, title, created_at, updated_at
        ) VALUES ('awen-project:project-live', 'Live', ${timestamp}, ${timestamp})
      `;
      yield* sql`
        INSERT INTO projection_awen_workspaces (
          workspace_id, awen_project_id, project_id, title, workspace_root, role,
          created_at, updated_at
        ) VALUES (
          'workspace:project-live', 'awen-project:project-live', 'project-live', 'Live',
          '/srv/live', 'main', ${timestamp}, ${timestamp}
        )
      `;

      yield* runMigrations({ toMigrationInclusive: 55 });

      const rows = yield* sql<{
        readonly workspaceId: string;
        readonly role: string;
        readonly origin: string | null;
      }>`
        SELECT workspace_id AS "workspaceId", role, origin
        FROM projection_awen_workspaces
      `;
      assert.deepEqual(rows, [
        { workspaceId: "workspace:project-live", role: "main", origin: null },
      ]);

      // New worktree workspaces can record how they came to exist.
      yield* sql`
        INSERT INTO projection_awen_workspaces (
          workspace_id, awen_project_id, project_id, title, workspace_root, role, origin,
          created_at, updated_at
        ) VALUES (
          'workspace:project-wt', 'awen-project:project-live', 'project-wt', 'Live WT',
          '/srv/live-wt', 'worktree', 'awen-created', ${timestamp}, ${timestamp}
        )
      `;
      const withOrigin = yield* sql<{
        readonly workspaceId: string;
        readonly origin: string | null;
      }>`
        SELECT workspace_id AS "workspaceId", origin
        FROM projection_awen_workspaces
        ORDER BY workspace_id ASC
      `;
      assert.deepEqual(withOrigin, [
        { workspaceId: "workspace:project-live", origin: null },
        { workspaceId: "workspace:project-wt", origin: "awen-created" },
      ]);
    }),
  );
});
