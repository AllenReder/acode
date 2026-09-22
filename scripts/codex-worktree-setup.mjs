#!/usr/bin/env node

import * as NodeChildProcess from "node:child_process";
import * as NodeFS from "node:fs";
import * as NodePath from "node:path";

import { packageManagerInvocation } from "./lib/spawn-command.ts";

const REQUIRED_FILES = ["package.json", "pnpm-lock.yaml"];

/**
 * Resolve the checkout that Codex created. The environment variable is set by
 * Codex's worktree hook; falling back to cwd keeps the script useful when run
 * manually from a checkout root.
 */
export function resolveCodexWorktreePath(environment = process.env, cwd = process.cwd()) {
  const configuredPath = environment.CODEX_WORKTREE_PATH?.trim();
  const worktreePath = NodePath.resolve(configuredPath || cwd);

  if (!NodeFS.existsSync(worktreePath) || !NodeFS.statSync(worktreePath).isDirectory()) {
    throw new Error(`Codex worktree does not exist or is not a directory: ${worktreePath}`);
  }

  for (const requiredFile of REQUIRED_FILES) {
    if (!NodeFS.existsSync(NodePath.join(worktreePath, requiredFile))) {
      throw new Error(`Codex worktree is missing ${requiredFile}: ${worktreePath}`);
    }
  }

  return worktreePath;
}

export function runWorktreeSetup({
  environment = process.env,
  cwd = process.cwd(),
  spawn = NodeChildProcess.spawnSync,
} = {}) {
  const worktreePath = resolveCodexWorktreePath(environment, cwd);
  const invocation = packageManagerInvocation(["install", "--frozen-lockfile"], { environment });

  console.log(`[acode] installing dependencies in ${worktreePath}`);
  const result = spawn(invocation.command, [...invocation.args], {
    cwd: worktreePath,
    env: environment,
    shell: invocation.shell,
    stdio: "inherit",
  });

  if (result.error) {
    throw new Error(`Could not start ${invocation.command}: ${result.error.message}`);
  }
  if (result.status !== 0) {
    const reason = result.signal ? `signal ${result.signal}` : `exit code ${String(result.status)}`;
    throw new Error(`Dependency installation failed with ${reason}.`);
  }
}

if (import.meta.main) {
  try {
    runWorktreeSetup();
  } catch (error) {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  }
}
