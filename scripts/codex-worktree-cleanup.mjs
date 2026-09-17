#!/usr/bin/env node

import * as NodeFS from "node:fs";
import * as NodePath from "node:path";

import { resolveCodexWorktreePath } from "./codex-worktree-setup.mjs";

// These are checkout-local outputs. Do not add home-directory paths, the
// global pnpm store, or shared caches here: Codex may run several worktrees
// for the same user at once.
export const WORKTREE_CLEANUP_TARGETS = [
  ".acode",
  ".generated",
  ".vite-plus",
  "apps/desktop/src-tauri/target",
  "apps/server/dist",
  "apps/web/dist",
];

function assertTargetIsInsideWorktree(worktreePath, targetPath) {
  const relativePath = NodePath.relative(worktreePath, targetPath);
  if (
    relativePath.length === 0 ||
    relativePath.startsWith(`..${NodePath.sep}`) ||
    NodePath.isAbsolute(relativePath)
  ) {
    throw new Error(`Refusing to clean a path outside the Codex worktree: ${targetPath}`);
  }
}

export function runWorktreeCleanup({ environment = process.env, cwd = process.cwd() } = {}) {
  const worktreePath = resolveCodexWorktreePath(environment, cwd);

  for (const relativeTarget of WORKTREE_CLEANUP_TARGETS) {
    const targetPath = NodePath.resolve(worktreePath, relativeTarget);
    assertTargetIsInsideWorktree(worktreePath, targetPath);
    if (!NodeFS.existsSync(targetPath)) continue;

    NodeFS.rmSync(targetPath, { force: true, recursive: true });
    console.log(`[acode] removed ${NodePath.relative(worktreePath, targetPath)}`);
  }
}

if (import.meta.main) {
  try {
    runWorktreeCleanup();
  } catch (error) {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  }
}
