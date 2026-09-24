import * as Effect from "effect/Effect";
import * as SqlClient from "effect/unstable/sql/SqlClient";

/**
 * Stores Awen navigation identity separately from Awen orchestration projects.
 * The backfill keeps existing registered directories visible after upgrading;
 * the deterministic ids are only a migration bridge, not an identity alias.
 */
export default Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;

  yield* sql`
    CREATE TABLE IF NOT EXISTS projection_awen_projects (
      awen_project_id TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    )
  `;

  yield* sql`
    CREATE TABLE IF NOT EXISTS projection_awen_workspaces (
      workspace_id TEXT PRIMARY KEY,
      awen_project_id TEXT NOT NULL,
      project_id TEXT NOT NULL UNIQUE,
      title TEXT NOT NULL,
      workspace_root TEXT NOT NULL UNIQUE,
      role TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    )
  `;

  yield* sql`
    CREATE INDEX IF NOT EXISTS idx_projection_awen_workspaces_project_id
    ON projection_awen_workspaces(awen_project_id)
  `;

  yield* sql`
    INSERT OR IGNORE INTO projection_awen_projects (
      awen_project_id, title, created_at, updated_at
    )
    SELECT
      'awen-project:' || project_id,
      title,
      created_at,
      updated_at
    FROM projection_projects
    WHERE deleted_at IS NULL
  `;

  yield* sql`
    INSERT OR IGNORE INTO projection_awen_workspaces (
      workspace_id,
      awen_project_id,
      project_id,
      title,
      workspace_root,
      role,
      created_at,
      updated_at
    )
    SELECT
      'workspace:' || project_id,
      'awen-project:' || project_id,
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
