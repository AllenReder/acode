/**
 * Terminating a launcher and the whole tree of processes beneath it.
 *
 * `scripts/workbench-e2e.mjs` starts `scripts/dev-runner.ts`, which resolves
 * `vp`, which starts a Vite+ core process, which runs `node --watch src/bin.ts`,
 * which runs the daemon that holds the temporary home's SQLite database. On
 * POSIX, signalling the launcher's process group reaches every one of them. On
 * Windows there is no process group and no signal handlers: `child.kill()`
 * terminates exactly one process, so the rest survive as orphans, keep the
 * database open, and make the harness's directory removal fail with `EBUSY`.
 *
 * On Windows the kill is therefore delegated to the host's own walk of the
 * launcher's tree (`taskkill /PID <launcher> /T /F`), issued while the launcher
 * is still alive to lead it. This module deliberately does **not** kill a list
 * of pids it inferred from `ParentProcessId` links: Windows never reparents an
 * orphan, so that field can keep naming a dead pid long after the process it
 * named is gone, and a reused pid makes the stale link look like a live child.
 * A tree assembled that way can absorb processes this run never spawned, and
 * killing by it risks terminating something unrelated.
 *
 * The process table is still read, before the kill, but only to observe: to
 * name what was in the tree, and to report what outlived it. Those observations
 * are filtered by creation time, because a pid is not an identity - a pid in a
 * pre-kill snapshot may name a different process by the time it is inspected.
 *
 * Teardown that must not mask the error that caused it lives in
 * `./teardown-steps.ts`.
 */

// @effect-diagnostics nodeBuiltinImport:off globalTimers:off globalDate:off - Standalone harness teardown runs before an Effect runtime exists.

import * as NodeChildProcess from "node:child_process";

/** One row of the host process table. */
export interface ProcessTableEntry {
  readonly pid: number;
  readonly parentPid: number;
  /** Process start time, in epoch milliseconds. Identity for a reused pid. */
  readonly createdAt: number;
}

/** Everything teardown needs from the host, injected so tests can fake it. */
export interface ProcessTreePort {
  readonly platform: NodeJS.Platform;
  /** `true` once the launcher has exited, by any means. */
  readonly hasRootExited: () => boolean;
  /** Resolves when the launcher exits; already settled when it already has. */
  readonly rootExited: Promise<void>;
  /**
   * Live processes, or `null` when the host cannot enumerate them completely.
   * Descendants cannot be observed at all without this.
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
  | { readonly status: "observed"; readonly tracked: ReadonlyArray<number> }
  | {
      readonly status: "skipped";
      readonly reason: "not-required" | "root-exited" | "enumeration-unavailable";
    };

/** How the tree stopped once teardown was done with it. */
export type TreeTermination =
  /** Nothing to stop: the launcher had already exited. */
  | "none"
  /** A signal drained the tree; nothing had to be force-killed. */
  | "graceful"
  /** The tree was force-killed, or forced after a signal went unanswered. */
  | "forced";

export interface StopProcessTreeResult {
  readonly strategy: "process-group" | "process-tree";
  readonly termination: TreeTermination;
  readonly descendants: DescendantSweep;
  /** Observed pids still alive when the wait expired. */
  readonly survivors: ReadonlyArray<number>;
  /** `false` when the process table went missing, leaving `survivors` unverified. */
  readonly verified: boolean;
}

export interface StopProcessTreeOptions {
  readonly rootPid: number;
  readonly port: ProcessTreePort;
}

/** Grace given to a graceful signal before the process group is force-killed. */
const GRACE_MS = 5_000;
/** How long the tree is given to disappear before leftovers are reported. */
const FORCE_MS = 10_000;
const POLL_INTERVAL_MS = 200;

/**
 * The launcher's pid and every pid the table reaches from it, for observation
 * only.
 *
 * A candidate is accepted only when it was created at or after the process it
 * claims to descend from: a real descendant cannot predate the process that
 * spawned it, which is what a stale `ParentProcessId` naming a later reused pid
 * looks like from the outside.
 */
export function collectProcessTree(
  rootPid: number,
  entries: ReadonlyArray<ProcessTableEntry>,
): ReadonlyArray<number> {
  const byPid = new Map(entries.map((entry) => [entry.pid, entry]));
  const root = byPid.get(rootPid);
  const collected = new Set<number>([rootPid]);
  if (root === undefined) return [rootPid];

  const childrenByParent = new Map<number, ProcessTableEntry[]>();
  for (const entry of entries) {
    const siblings = childrenByParent.get(entry.parentPid);
    if (siblings === undefined) {
      childrenByParent.set(entry.parentPid, [entry]);
      continue;
    }
    siblings.push(entry);
  }

  const pending: ProcessTableEntry[] = [root];
  for (;;) {
    const parent = pending.pop();
    if (parent === undefined) break;
    for (const child of childrenByParent.get(parent.pid) ?? []) {
      if (collected.has(child.pid)) continue;
      if (child.createdAt < parent.createdAt) continue;
      collected.add(child.pid);
      pending.push(child);
    }
  }

  return [...collected].sort((left, right) => left - right);
}

/**
 * Terminate `rootPid` and the tree it leads, then wait for that tree to be
 * gone before returning.
 *
 * The table is read before the kill, because after it there is nothing left to
 * read: the launcher is gone and Windows has left its orphans nameless.
 */
export async function stopProcessTree(
  options: StopProcessTreeOptions,
): Promise<StopProcessTreeResult> {
  const { port, rootPid } = options;

  if (port.platform !== "win32") {
    return stopProcessGroup({ port, rootPid });
  }

  if (port.hasRootExited()) {
    // Nothing leads the subtree any more, and the orphans it left behind are
    // exactly what cannot be told apart from unrelated processes. Report that
    // instead of guessing at a tree to kill.
    return {
      descendants: { status: "skipped", reason: "root-exited" },
      strategy: "process-tree",
      survivors: [],
      termination: "none",
      verified: false,
    };
  }

  const table = await port.listProcesses();
  const tracked = table === null ? [] : collectProcessTree(rootPid, table);
  const createdAtByPid = new Map(
    (table ?? [])
      .filter((entry) => tracked.includes(entry.pid))
      .map((entry) => [entry.pid, entry.createdAt]),
  );

  // One OS-walked kill of the tree the launcher still leads. Re-issuing this
  // per inferred pid would add nothing: a process that survives this survives
  // it for permission reasons that a per-pid attempt cannot overcome either.
  await port.forceKillProcessTree(rootPid);

  if (table === null) {
    await Promise.race([port.rootExited.then(() => true), port.sleep(FORCE_MS).then(() => false)]);
    return {
      descendants: { status: "skipped", reason: "enumeration-unavailable" },
      strategy: "process-tree",
      survivors: [],
      termination: "forced",
      verified: false,
    };
  }

  const survivors = await waitForObservedExit(port, tracked, createdAtByPid);
  return {
    descendants: { status: "observed", tracked },
    strategy: "process-tree",
    survivors: survivors ?? [],
    termination: "forced",
    verified: survivors !== null,
  };
}

/**
 * Wait for the observed processes to disappear, and report the ones that do
 * not.
 *
 * A pid whose creation time moved is a different process that reused the
 * number, so it is neither a survivor nor a reason to keep waiting.
 */
async function waitForObservedExit(
  port: ProcessTreePort,
  observed: ReadonlyArray<number>,
  createdAtByPid: ReadonlyMap<number, number>,
): Promise<ReadonlyArray<number> | null> {
  const deadline = port.now() + FORCE_MS;
  for (;;) {
    const live = await port.listProcesses();
    if (live === null) return null;
    const ours = new Set(
      live
        .filter((entry) => createdAtByPid.get(entry.pid) === entry.createdAt)
        .map((entry) => entry.pid),
    );
    const alive = observed.filter((pid) => ours.has(pid));
    if (alive.length === 0) return alive;
    if (port.now() >= deadline) return alive;
    await port.sleep(POLL_INTERVAL_MS);
  }
}

async function stopProcessGroup(input: {
  readonly port: ProcessTreePort;
  readonly rootPid: number;
}): Promise<StopProcessTreeResult> {
  const { port, rootPid } = input;
  const settled = (overrides: Partial<StopProcessTreeResult>): StopProcessTreeResult => ({
    descendants: { status: "skipped", reason: "not-required" },
    strategy: "process-group",
    survivors: [],
    termination: "none",
    verified: true,
    ...overrides,
  });

  if (port.hasRootExited()) return settled({});

  // POSIX has a real process group and real signals, so this is not the
  // fiction it would be on Windows: the group can drain without a kill.
  await port.signalProcessGroup(rootPid, "SIGTERM");
  const drained = await Promise.race([
    port.rootExited.then(() => true),
    port.sleep(GRACE_MS).then(() => false),
  ]);
  if (drained) return settled({ termination: "graceful" });

  await port.signalProcessGroup(rootPid, "SIGKILL");
  await port.rootExited;
  return settled({ termination: "forced" });
}

function delay(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

async function runProcess(
  command: string,
  args: ReadonlyArray<string>,
): Promise<{ readonly ok: boolean; readonly stdout: string }> {
  return new Promise((resolve) => {
    const child = NodeChildProcess.execFile(
      command,
      [...args],
      { maxBuffer: 32 * 1024 * 1024, windowsHide: true },
      (error, stdout) => resolve({ ok: error === null, stdout }),
    );
    child.on("error", () => resolve({ ok: false, stdout: "" }));
  });
}

/** `ConvertTo-Json` renders a DateTime as `/Date(ms)/` on Windows PowerShell and ISO-8601 on PowerShell 7. */
function parseCreationTime(value: unknown): number | null {
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (typeof value !== "string") return null;
  const dotNetDate = /^\/Date\((-?\d+)(?:[+-]\d{4})?\)\/$/.exec(value);
  if (dotNetDate !== null) return Number(dotNetDate[1]);
  const parsed = Date.parse(value);
  return Number.isNaN(parsed) ? null : parsed;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

/**
 * Read the whole table, or `null` if any row cannot be dated.
 *
 * A partially usable table is worse than none: a row without a creation time
 * cannot be validated as a descendant, and dropping it would silently drop the
 * subtree below it, so the caller is told the table is unavailable instead.
 */
async function listWindowsProcesses(): Promise<ReadonlyArray<ProcessTableEntry> | null> {
  const { ok, stdout } = await runProcess("powershell.exe", [
    "-NoProfile",
    "-NonInteractive",
    "-Command",
    "Get-CimInstance Win32_Process | Select-Object ProcessId,ParentProcessId,CreationDate | ConvertTo-Json -Compress",
  ]);
  if (!ok) return null;

  const text = stdout.replace(/^\uFEFF/, "").trim();
  if (text.length === 0) return [];
  try {
    const parsed: unknown = JSON.parse(text);
    const rows = Array.isArray(parsed) ? parsed : [parsed];
    const entries: ProcessTableEntry[] = [];
    for (const row of rows) {
      if (!isRecord(row)) return null;
      const { ProcessId: pid, ParentProcessId: parentPid, CreationDate: createdAt } = row;
      const createdAtMs = parseCreationTime(createdAt);
      if (typeof pid !== "number" || typeof parentPid !== "number" || createdAtMs === null) {
        return null;
      }
      entries.push({ createdAt: createdAtMs, parentPid, pid });
    }
    return entries;
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
      await runProcess("taskkill", ["/PID", String(pid), "/T", "/F"]);
    },
    hasRootExited,
    listProcesses: async () => (platform === "win32" ? listWindowsProcesses() : null),
    now: () => Date.now(),
    platform,
    rootExited,
    signalProcess: (pid, signalName) => signal(pid, signalName),
    signalProcessGroup: (pid, signalName) => signal(-pid, signalName),
    sleep: delay,
  };
}
