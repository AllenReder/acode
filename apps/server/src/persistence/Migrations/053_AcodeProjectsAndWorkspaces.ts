import * as Effect from "effect/Effect";
import * as SqlClient from "effect/unstable/sql/SqlClient";

/**
 * Stores ACode navigation identity separately from T3 orchestration projects.
 * The backfill keeps existing registered directories visible after upgrading;
 * the deterministic ids are only a migration bridge, not an identity alias.
 */
export default Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;

  yield* sql`
    CREATE TABLE IF NOT EXISTS projection_acode_projects (
      acode_project_id TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    )
  `;

  yield* sql`
    CREATE TABLE IF NOT EXISTS projection_acode_workspaces (
      workspace_id TEXT PRIMARY KEY,
      acode_project_id TEXT NOT NULL,
      t3_project_id TEXT NOT NULL UNIQUE,
      title TEXT NOT NULL,
      workspace_root TEXT NOT NULL UNIQUE,
      role TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    )
  `;

  yield* sql`
    CREATE INDEX IF NOT EXISTS idx_projection_acode_workspaces_project_id
    ON projection_acode_workspaces(acode_project_id)
  `;

  yield* sql`
    INSERT OR IGNORE INTO projection_acode_projects (
      acode_project_id, title, created_at, updated_at
    )
    SELECT
      'acode-project:' || project_id,
      title,
      created_at,
      updated_at
    FROM projection_projects
    WHERE deleted_at IS NULL
  `;

  yield* sql`
    INSERT OR IGNORE INTO projection_acode_workspaces (
      workspace_id,
      acode_project_id,
      t3_project_id,
      title,
      workspace_root,
      role,
      created_at,
      updated_at
    )
    SELECT
      'workspace:' || project_id,
      'acode-project:' || project_id,
      project_id,
      title,
      workspace_root,
      'main',
      created_at,
      updated_at
    FROM projection_projects
    WHERE deleted_at IS NULL
  `;
});
