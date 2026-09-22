/**
 * Teardown for harnesses that spawn a launcher which in turn spawns a tree of
 * processes.
 *
 * `scripts/workbench-e2e.mjs` starts `scripts/dev-runner.ts`, which resolves
 * `vp`, which starts a Vite+ core process, which runs `node --watch src/bin.ts`,
 * which runs the daemon that holds the temporary home's SQLite database. On
 * POSIX, signalling the launcher's process group reaches every one of them. On
 * Windows there is no process group and there are no signal handlers:
 * `child.kill()` terminates exactly one process, so the rest survive as
 * orphans, keep the database open, and make the harness's directory removal
 * fail with `EBUSY` - an error thrown from `finally`, which then replaces the
 * failure that actually caused the teardown.
 *
 * This module owns both halves of that problem: terminating the whole tree, and
 * running teardown steps that are not allowed to mask the error that made them
 * run. Both are expressed over an injected {@link ProcessTreePort} so the
 * platform branches are testable without spawning real processes.
 */

// @effect-diagnostics nodeBuiltinImport:off globalTimers:off globalDate:off - Standalone harness teardown runs before an Effect runtime exists.

import * as NodeChildProcess from "node:child_process";
import * as NodeFSP from "node:fs/promises";

/** One row of the host process table. */
export interface ProcessTableEntry {
  readonly pid: number;
  readonly parentPid: number;
}

/** Everything teardown needs from the host, injected so tests can fake it. */
export interface ProcessTreePort {
  readonly platform: NodeJS.Platform;
  /** `true` once the launcher has exited, by any means. */
  readonly hasRootExited: () => boolean;
  /** Resolves when the launcher exits; already settled when it already has. */
  readonly rootExited: Promise<void>;
  /**
   * Live processes, or `null` when the host cannot enumerate them. Descendants
   * cannot be tracked at all without this.
   */
  readonly listProcesses: () => Promise<ReadonlyArray<ProcessTableEntry> | null>;
  /** Signal one process. A process that is already gone is not an error. */
  readonly signalProcess: (pid: number, signal: NodeJS.Signals) => Promise<void>;
  /** Signal the process group led by `pid`. POSIX only. */
  readonly signalProcessGroup: (pid: number, signal: NodeJS.Signals) => Promise<void>;
  /** Force-terminate `pid` and every descendant it still leads. */
  readonly forceKillProcessTree: (pid: number) => Promise<void>;
  readonly sleep: (milliseconds: number) => Promise<void>;
  readonly now: () => number;
}

/** How the descendants of the launcher were accounted for. */
export type DescendantSweep =
  | { readonly status: "swept"; readonly tracked: ReadonlyArray<number> }
  | {
      readonly status: "skipped";
      readonly reason: "not-required" | "root-exited" | "enumeration-unavailable";
    };

export interface StopProcessTreeResult {
  readonly strategy: "process-group" | "process-tree";
  /** Whether the tree drained without needing a force kill. */
  readonly graceful: boolean;
  readonly descendants: DescendantSweep;
  /** Tracked PIDs still alive when the wait expired. */
  readonly survivors: ReadonlyArray<number>;
  /** `false` when the process table went missing, leaving `survivors` unverified. */
  readonly verified: boolean;
}

export interface StopProcessTreeOptions {
  readonly rootPid: number;
  readonly port: ProcessTreePort;
  /** Grace given to a graceful signal before the tree is force-killed. */
  readonly graceMs?: number;
  /** Grace given to the force kill before leftover PIDs are reported. */
  readonly forceMs?: number;
  readonly pollIntervalMs?: number;
}

const DEFAULT_GRACE_MS = 5_000;
const DEFAULT_FORCE_MS = 10_000;
const DEFAULT_POLL_INTERVAL_MS = 200;

/**
 * The launcher's PID and every PID reachable from it in `entries`.
 *
 * Windows reparents orphans, so a tree is only recoverable from a table read
 * taken while its root is still alive.
 */
export function collectProcessTree(
  rootPid: number,
  entries: ReadonlyArray<ProcessTableEntry>,
): ReadonlyArray<number> {
  const childrenByParent = new Map<number, number[]>();
  for (const entry of entries) {
    const siblings = childrenByParent.get(entry.parentPid);
    if (siblings === undefined) {
      childrenByParent.set(entry.parentPid, [entry.pid]);
      continue;
    }
    siblings.push(entry.pid);
  }

  const collected = new Set<number>();
  const pending = [rootPid];
  for (;;) {
    const pid = pending.pop();
    if (pid === undefined) break;
    if (collected.has(pid)) continue;
    collected.add(pid);
    for (const child of childrenByParent.get(pid) ?? []) pending.push(child);
  }
  return [...collected].sort((left, right) => left - right);
}

/**
 * Terminate `rootPid` and everything it leads, and do not return until the tree
 * is gone or the wait is over.
 *
 * On Windows the process table is read *before* any signal is sent. A graceful
 * signal to the launcher kills it outright (`SIGTERM` is `TerminateProcess`
 * there, so nothing can handle it), which orphans the subtree and puts it out
 * of `taskkill /T`'s reach - that is precisely how the daemon used to survive
 * teardown. Tracking the PIDs first is what makes the sweep possible afterwards.
 */
export async function stopProcessTree(
  options: StopProcessTreeOptions,
): Promise<StopProcessTreeResult> {
  const { port, rootPid } = options;
  const graceMs = options.graceMs ?? DEFAULT_GRACE_MS;
  const forceMs = options.forceMs ?? DEFAULT_FORCE_MS;
  const pollIntervalMs = options.pollIntervalMs ?? DEFAULT_POLL_INTERVAL_MS;

  if (port.platform !== "win32") {
    return stopProcessGroup({ graceMs, port, rootPid });
  }

  if (port.hasRootExited()) {
    // Nothing leads the subtree any more, and Windows has already reparented it.
    return {
      descendants: { status: "skipped", reason: "root-exited" },
      graceful: false,
      strategy: "process-tree",
      survivors: [],
      verified: false,
    };
  }

  const table = await port.listProcesses();
  if (table === null) {
    // Tracking is unavailable, so a graceful signal would orphan the subtree
    // before `taskkill /T` could reach it. Force-kill the tree while the
    // launcher still leads it instead.
    await port.forceKillProcessTree(rootPid);
    return {
      descendants: { status: "skipped", reason: "enumeration-unavailable" },
      graceful: false,
      strategy: "process-tree",
      survivors: [],
      verified: false,
    };
  }

  const tracked = collectProcessTree(rootPid, table);
  const waitForDrain = async (budgetMs: number): Promise<ReadonlyArray<number> | null> => {
    const deadline = port.now() + budgetMs;
    for (;;) {
      const live = await port.listProcesses();
      if (live === null) return null;
      const livePids = new Set(live.map((entry) => entry.pid));
      const alive = tracked.filter((pid) => livePids.has(pid));
      if (alive.length === 0) return alive;
      if (port.now() >= deadline) return alive;
      await port.sleep(pollIntervalMs);
    }
  };

  await port.signalProcess(rootPid, "SIGTERM");
  const afterGrace = await waitForDrain(graceMs);
  if (afterGrace !== null && afterGrace.length === 0) {
    return {
      descendants: { status: "swept", tracked },
      graceful: true,
      strategy: "process-tree",
      survivors: [],
      verified: true,
    };
  }

  // The launcher's own tree first, then anything the signal already orphaned
  // out of it. Force-killing a pid that is already gone is not an error.
  await port.forceKillProcessTree(rootPid);
  for (const pid of afterGrace ?? tracked) {
    if (pid !== rootPid) await port.forceKillProcessTree(pid);
  }
  const survivors = await waitForDrain(forceMs);
  return {
    descendants: { status: "swept", tracked },
    graceful: false,
    strategy: "process-tree",
    survivors: survivors ?? [],
    verified: survivors !== null,
  };
}

async function stopProcessGroup(input: {
  readonly graceMs: number;
  readonly port: ProcessTreePort;
  readonly rootPid: number;
}): Promise<StopProcessTreeResult> {
  const { graceMs, port, rootPid } = input;
  const unchanged = (overrides: Partial<StopProcessTreeResult>): StopProcessTreeResult => ({
    descendants: { status: "skipped", reason: "not-required" },
    graceful: false,
    strategy: "process-group",
    survivors: [],
    verified: true,
    ...overrides,
  });

  if (port.hasRootExited()) return unchanged({ graceful: true });

  await port.signalProcessGroup(rootPid, "SIGTERM");
  const drained = await Promise.race([
    port.rootExited.then(() => true),
    port.sleep(graceMs).then(() => false),
  ]);
  if (drained) return unchanged({ graceful: true });

  await port.signalProcessGroup(rootPid, "SIGKILL");
  await port.rootExited;
  return unchanged({});
}

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
      reason = describeError(error);
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
 * A teardown step that throws from `finally` replaces the error that made the
 * harness fail in the first place, which is what turned a `browser.launch`
 * failure into an unattributable `EBUSY`.
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

function describeError(error: unknown): string {
  if (error instanceof Error) return error.message;
  return String(error);
}

function errorCode(error: unknown): string | null {
  if (typeof error !== "object" || error === null) return null;
  if (!("code" in error) || typeof error.code !== "string") return null;
  return error.code;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function runBestEffort(command: string, args: ReadonlyArray<string>): Promise<void> {
  return new Promise((resolve) => {
    const child = NodeChildProcess.execFile(command, [...args], { windowsHide: true }, () =>
      resolve(),
    );
    child.on("error", () => resolve());
  });
}

function captureBestEffort(command: string, args: ReadonlyArray<string>): Promise<string | null> {
  return new Promise((resolve) => {
    const child = NodeChildProcess.execFile(
      command,
      [...args],
      { maxBuffer: 32 * 1024 * 1024, windowsHide: true },
      (error, stdout) => resolve(error === null ? stdout : null),
    );
    child.on("error", () => resolve(null));
  });
}

async function listWindowsProcesses(): Promise<ReadonlyArray<ProcessTableEntry> | null> {
  const output = await captureBestEffort("powershell.exe", [
    "-NoProfile",
    "-NonInteractive",
    "-Command",
    "Get-CimInstance Win32_Process | Select-Object ProcessId,ParentProcessId | ConvertTo-Json -Compress",
  ]);
  if (output === null) return null;

  const text = output.replace(/^\uFEFF/, "").trim();
  if (text.length === 0) return [];
  try {
    const parsed: unknown = JSON.parse(text);
    const rows = Array.isArray(parsed) ? parsed : [parsed];
    return rows.flatMap((row) => {
      if (!isRecord(row)) return [];
      const { ProcessId: pid, ParentProcessId: parentPid } = row;
      if (typeof pid !== "number" || typeof parentPid !== "number") return [];
      return [{ parentPid, pid }];
    });
  } catch {
    return null;
  }
}

export interface ProcessTreePortOptions {
  readonly platform: NodeJS.Platform;
  readonly hasRootExited: () => boolean;
  readonly rootExited: Promise<void>;
}

/**
 * The host-backed port. `listProcesses` is Windows-only on purpose: POSIX
 * teardown signals the launcher's process group, which already covers every
 * descendant, so it needs no table read.
 */
export function createProcessTreePort(options: ProcessTreePortOptions): ProcessTreePort {
  const { hasRootExited, platform, rootExited } = options;
  const signal = async (pid: number, signalName: NodeJS.Signals): Promise<void> => {
    try {
      process.kill(pid, signalName);
    } catch {
      // A process or group that is already gone needs no signal.
    }
  };

  return {
    forceKillProcessTree: async (pid) => {
      if (platform !== "win32") {
        await signal(-pid, "SIGKILL");
        return;
      }
      await runBestEffort("taskkill", ["/PID", String(pid), "/T", "/F"]);
    },
    hasRootExited,
    listProcesses: async () => (platform === "win32" ? listWindowsProcesses() : null),
    now: () => Date.now(),
    platform,
    rootExited,
    signalProcess: (pid, signalName) => signal(pid, signalName),
    signalProcessGroup: (pid, signalName) => signal(-pid, signalName),
    sleep: (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds)),
  };
}
