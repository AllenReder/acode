import * as Effect from "effect/Effect";
import * as SqlClient from "effect/unstable/sql/SqlClient";

/**
 * Persists the ACode identity that points at a durable T3 thread. Runtime and
 * provider session identifiers deliberately do not participate in this key.
 */
export default Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;

  yield* sql`
    CREATE TABLE IF NOT EXISTS projection_acode_agent_sessions (
      agent_session_id TEXT PRIMARY KEY,
      workspace_id TEXT NOT NULL,
      t3_project_id TEXT NOT NULL,
      thread_id TEXT NOT NULL UNIQUE,
      title TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      archived_at TEXT,
      deleted_at TEXT
    )
  `;

  yield* sql`
    CREATE INDEX IF NOT EXISTS idx_projection_acode_agent_sessions_workspace_id
    ON projection_acode_agent_sessions(workspace_id, archived_at, deleted_at, created_at)
  `;

  yield* sql`
    CREATE INDEX IF NOT EXISTS idx_projection_acode_agent_sessions_t3_project_id
    ON projection_acode_agent_sessions(t3_project_id)
  `;

  // Existing T3 threads become ACode sessions on upgrade. This legacy prefix
  // is only a migration identity; newly created sessions use their creation
  // event id and never derive identity from a provider or thread id.
  yield* sql`
    INSERT OR IGNORE INTO projection_acode_agent_sessions (
      agent_session_id,
      workspace_id,
      t3_project_id,
      thread_id,
      title,
      created_at,
      updated_at,
      archived_at,
      deleted_at
    )
    SELECT
      'agent-session:legacy:' || threads.thread_id,
      workspaces.workspace_id,
      threads.project_id,
      threads.thread_id,
      threads.title,
      threads.created_at,
      threads.updated_at,
      threads.archived_at,
      threads.deleted_at
    FROM projection_threads AS threads
    INNER JOIN projection_acode_workspaces AS workspaces
      ON workspaces.t3_project_id = threads.project_id
    WHERE threads.deleted_at IS NULL
  `;
});
