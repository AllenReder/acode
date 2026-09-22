/**
 * Teardown steps that are not allowed to mask the failure that caused them.
 *
 * A harness that cleans up from `finally` and lets a step throw will report the
 * cleanup error instead of the real one: `scripts/workbench-e2e.mjs` used to
 * surface a `browser.launch` failure as an unattributable `EBUSY` because
 * removing the temporary home threw from `finally`. Windows makes that easy to
 * hit, since it refuses to delete a file that is still open.
 *
 * Nothing here throws. Failures are reported so the caller stays in control of
 * its own exit status, and a stalled removal reports the path it kept instead
 * of taking the run down with it.
 */

// @effect-diagnostics nodeBuiltinImport:off globalTimers:off - Standalone harness teardown runs before an Effect runtime exists.

import * as NodeFSP from "node:fs/promises";

export interface RemovePathResult {
  readonly removed: boolean;
  readonly attempts: number;
  /** Failure of the last attempt; `null` when the path was removed. */
  readonly reason: string | null;
}

export interface RemovePathOptions {
  /** Delays between attempts. One attempt runs before the first delay. */
  readonly delaysMs?: ReadonlyArray<number>;
  readonly sleep?: (milliseconds: number) => Promise<void>;
  /** Removal primitive, injectable so the retry policy is testable on any host. */
  readonly remove?: (path: string) => Promise<void>;
}

const RETRYABLE_REMOVE_CODES = new Set(["EBUSY", "EPERM", "EACCES", "ENOTEMPTY"]);
const DEFAULT_REMOVE_DELAYS_MS = [100, 250, 500, 1_000, 2_000, 4_000];

/**
 * Remove a directory tree, retrying the codes Windows raises when a handle is
 * still open or a lock has not been released yet.
 *
 * This never throws: it reports, so a caller inside `finally` cannot let a
 * stalled cleanup replace the failure that caused the cleanup.
 */
export async function removePathWithRetry(
  path: string,
  options: RemovePathOptions = {},
): Promise<RemovePathResult> {
  const delaysMs = options.delaysMs ?? DEFAULT_REMOVE_DELAYS_MS;
  const sleep =
    options.sleep ??
    ((milliseconds: number) => new Promise((resolve) => setTimeout(resolve, milliseconds)));
  const remove =
    options.remove ?? ((target: string) => NodeFSP.rm(target, { force: true, recursive: true }));

  let reason: string | null = null;
  for (let attempt = 1; ; attempt += 1) {
    try {
      await remove(path);
      return { attempts: attempt, reason: null, removed: true };
    } catch (error) {
      reason = error instanceof Error ? error.message : String(error);
      const code = errorCode(error);
      if (code === null || !RETRYABLE_REMOVE_CODES.has(code)) {
        return { attempts: attempt, reason, removed: false };
      }
    }
    const delay = delaysMs[attempt - 1];
    if (delay === undefined) return { attempts: attempt, reason, removed: false };
    await sleep(delay);
  }
}

function errorCode(error: unknown): string | null {
  if (typeof error !== "object" || error === null) return null;
  if (!("code" in error) || typeof error.code !== "string") return null;
  return error.code;
}

export interface TeardownStep {
  readonly label: string;
  readonly run: () => Promise<void> | void;
}

export interface TeardownFailure {
  readonly label: string;
  readonly error: unknown;
}

/**
 * Run every step, in order, even after one fails, and collect the failures
 * instead of throwing them.
 *
 * A step that throws from `finally` replaces the error that made the harness
 * fail in the first place, and it also skips the steps after it - so a browser
 * that refuses to close would stop the daemon from ever being stopped.
 */
export async function runTeardownSteps(
  steps: ReadonlyArray<TeardownStep>,
): Promise<ReadonlyArray<TeardownFailure>> {
  const failures: TeardownFailure[] = [];
  for (const step of steps) {
    try {
      await step.run();
    } catch (error) {
      failures.push({ error, label: step.label });
    }
  }
  return failures;
}
