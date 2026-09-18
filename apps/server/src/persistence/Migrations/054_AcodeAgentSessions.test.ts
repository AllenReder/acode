import { assert, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as SqlClient from "effect/unstable/sql/SqlClient";

import * as NodeSqliteClient from "@t3tools/shared/nodeSqliteClient";
import { runMigrations } from "../Migrations.ts";

it.layer(NodeSqliteClient.layerMemory())("054_AcodeAgentSessions", (it) => {
  it.effect("backfills active T3 threads into their owning ACode workspace", () =>
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
      const timestamp = "2026-09-18T00:00:00.000Z";

      yield* runMigrations({ toMigrationInclusive: 53 });
      yield* sql`
        INSERT INTO projection_projects (
          project_id, title, workspace_root, scripts_json, created_at, updated_at, deleted_at
        ) VALUES (
          'project-session', 'Session project', '/tmp/session-project', '[]',
          ${timestamp}, ${timestamp}, NULL
        )
      `;
      yield* sql`
        INSERT INTO projection_acode_projects (
          acode_project_id, title, created_at, updated_at
        ) VALUES (
          'acode-project:project-session', 'Session project', ${timestamp}, ${timestamp}
        )
      `;
      yield* sql`
        INSERT INTO projection_acode_workspaces (
          workspace_id, acode_project_id, t3_project_id, title, workspace_root,
          role, created_at, updated_at
        ) VALUES (
          'workspace:project-session', 'acode-project:project-session', 'project-session',
          'Session project', '/tmp/session-project', 'main', ${timestamp}, ${timestamp}
        )
      `;
      yield* sql`
        INSERT INTO projection_threads (
          thread_id, project_id, title, model_selection_json, runtime_mode,
          interaction_mode, created_at, updated_at, archived_at, deleted_at
        ) VALUES (
          'thread-session', 'project-session', 'Persisted session',
          '{"instanceId":"codex","model":"gpt-5.4"}', 'full-access', 'default',
          ${timestamp}, ${timestamp}, NULL, NULL
        )
      `;

      yield* runMigrations({ toMigrationInclusive: 54 });

      const rows = yield* sql<{
        readonly agentSessionId: string;
        readonly workspaceId: string;
        readonly t3ProjectId: string;
        readonly threadId: string;
      }>`
        SELECT
          agent_session_id AS "agentSessionId",
          workspace_id AS "workspaceId",
          t3_project_id AS "t3ProjectId",
          thread_id AS "threadId"
        FROM projection_acode_agent_sessions
      `;

      assert.deepEqual(rows, [
        {
          agentSessionId: "agent-session:legacy:thread-session",
          workspaceId: "workspace:project-session",
          t3ProjectId: "project-session",
          threadId: "thread-session",
        },
      ]);
    }),
  );
});
