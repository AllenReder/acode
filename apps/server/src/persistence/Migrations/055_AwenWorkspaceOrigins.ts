import * as Effect from "effect/Effect";
import * as SqlClient from "effect/unstable/sql/SqlClient";

/**
 * Records how a worktree Workspace came to exist. Awen deletes directories
 * only for worktrees it created, so the remove-with-delete action reads this
 * column. Existing rows are "main" registrations and keep NULL.
 */
export default Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;

  yield* sql`
    ALTER TABLE projection_awen_workspaces
    ADD COLUMN origin TEXT
  `;
});
