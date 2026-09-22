// @effect-diagnostics nodeBuiltinImport:off - Tests exercise the host teardown boundary through fake process ports.

import * as NodeFSP from "node:fs/promises";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";

import { describe, expect, it } from "vite-plus/test";

import {
  collectProcessTree,
  createProcessTreePort,
  removePathWithRetry,
  runTeardownSteps,
  stopProcessTree,
  type ProcessTableEntry,
  type ProcessTreePort,
} from "./process-teardown.ts";

interface FakeProcess {
  readonly pid: number;
  readonly parentPid: number;
  /** Survives every kill attempt, standing in for a leaked handle holder. */
  readonly immortal?: boolean;
}

interface FakeHost {
  readonly calls: string[];
  readonly port: ProcessTreePort;
  alivePids: () => ReadonlyArray<number>;
}

/**
 * A process table that reacts the way the host does: a graceful signal reaches
 * exactly one process (Windows terminates it outright), a group signal reaches
 * the tree the launcher leads, and a force kill takes a pid with everything
 * still below it.
 */
function createFakeHost(input: {
  readonly platform: NodeJS.Platform;
  readonly rootPid: number;
  readonly processes: ReadonlyArray<FakeProcess>;
  readonly enumerable?: boolean;
  readonly drainsGracefully?: boolean;
  /** When true every graceful signal is ignored, as a launcher that hangs would. */
  readonly ignoresGracefulSignal?: boolean;
}): FakeHost {
  const calls: string[] = [];
  const processes = input.processes.map((entry) => ({ ...entry }));
  const enumerable = input.enumerable ?? true;
  let clock = 0;
  const exit = Promise.withResolvers<void>();

  const isAlive = (pid: number): boolean => processes.some((entry) => entry.pid === pid);

  const childPidsOf = (pid: number): ReadonlyArray<number> => {
    const children = processes.filter((entry) => entry.parentPid === pid).map((entry) => entry.pid);
    return [...children, ...children.flatMap((child) => childPidsOf(child))];
  };

  const settle = (): void => {
    if (!isAlive(input.rootPid)) exit.resolve();
  };

  /** A signal reaches one process; Windows terminates it without warning. */
  const removeOne = (pid: number): void => {
    const index = processes.findIndex((entry) => entry.pid === pid);
    if (processes[index]?.immortal !== true && index >= 0) processes.splice(index, 1);
    settle();
  };

  /** A force kill or a process-group signal takes the whole subtree. */
  const removeSubtree = (pid: number): void => {
    for (const target of [pid, ...childPidsOf(pid)]) {
      const index = processes.findIndex((entry) => entry.pid === target);
      if (processes[index]?.immortal === true || index < 0) continue;
      processes.splice(index, 1);
    }
    settle();
  };

  const drainGracefully = (): void => {
    for (const pid of processes.map((entry) => entry.pid)) removeOne(pid);
  };

  return {
    alivePids: () => processes.map((entry) => entry.pid),
    calls,
    port: {
      forceKillProcessTree: async (pid) => {
        calls.push(`taskkill /PID ${pid} /T /F`);
        removeSubtree(pid);
      },
      hasRootExited: () => !isAlive(input.rootPid),
      listProcesses: async (): Promise<ReadonlyArray<ProcessTableEntry> | null> =>
        enumerable ? processes.map(({ parentPid, pid }) => ({ parentPid, pid })) : null,
      now: () => clock,
      platform: input.platform,
      rootExited: exit.promise,
      signalProcess: async (pid, signal) => {
        calls.push(`signal ${pid} ${signal}`);
        if (input.ignoresGracefulSignal === true && signal === "SIGTERM") return;
        if (signal === "SIGTERM") {
          if (input.drainsGracefully === true) drainGracefully();
          else removeOne(pid);
          return;
        }
        removeOne(pid);
      },
      // The port negates the launcher pid to address its process group; the
      // fake's group is the tree the launcher leads.
      signalProcessGroup: async (pid, signal) => {
        calls.push(`group -${pid} ${signal}`);
        if (input.ignoresGracefulSignal === true && signal === "SIGTERM") return;
        if (signal === "SIGTERM" && input.drainsGracefully !== true) return;
        removeSubtree(pid);
      },
      sleep: async (milliseconds) => {
        clock += milliseconds;
      },
    },
  };
}

function failure(code: string): Error & { code: string } {
  return Object.assign(new Error(`${code}: resource busy or locked`), { code });
}

describe("collectProcessTree", () => {
  it("collects the launcher and its whole subtree, ignoring unrelated branches", () => {
    const entries: ReadonlyArray<ProcessTableEntry> = [
      { parentPid: 1, pid: 100 },
      { parentPid: 100, pid: 200 },
      { parentPid: 200, pid: 300 },
      { parentPid: 300, pid: 400 },
      { parentPid: 1, pid: 900 },
      { parentPid: 900, pid: 901 },
    ];

    expect(collectProcessTree(100, entries)).toEqual([100, 200, 300, 400]);
  });

  it("returns only the launcher when the table no longer links its descendants", () => {
    const entries: ReadonlyArray<ProcessTableEntry> = [
      { parentPid: 1, pid: 200 },
      { parentPid: 200, pid: 300 },
    ];

    expect(collectProcessTree(100, entries)).toEqual([100]);
  });

  it("terminates on a table that links a process to itself", () => {
    expect(collectProcessTree(100, [{ parentPid: 100, pid: 100 }])).toEqual([100]);
  });
});

describe("stopProcessTree on win32", () => {
  const tree: ReadonlyArray<FakeProcess> = [
    { parentPid: 1, pid: 100 },
    { parentPid: 100, pid: 200 },
    { parentPid: 200, pid: 300 },
    { parentPid: 300, pid: 400 },
  ];

  it("reports no survivors when the launcher's tree drains on the graceful signal", async () => {
    const host = createFakeHost({
      drainsGracefully: true,
      platform: "win32",
      processes: tree,
      rootPid: 100,
    });

    const result = await stopProcessTree({ port: host.port, rootPid: 100 });

    expect(result).toMatchObject({
      descendants: { status: "swept", tracked: [100, 200, 300, 400] },
      graceful: true,
      survivors: [],
      verified: true,
    });
    expect(host.calls).toEqual(["signal 100 SIGTERM"]);
  });

  it("sweeps the subtree that the graceful signal orphaned out of the launcher's reach", async () => {
    // `SIGTERM` on Windows terminates the launcher outright, so `taskkill /T`
    // against it can no longer reach anything below it. The daemon holding the
    // temporary home's database is the process that has to be swept by pid.
    const host = createFakeHost({ platform: "win32", processes: tree, rootPid: 100 });

    const result = await stopProcessTree({ port: host.port, rootPid: 100 });

    expect(result.graceful).toBe(false);
    expect(result.survivors).toEqual([]);
    expect(host.alivePids()).toEqual([]);
    expect(host.calls).toContain("signal 100 SIGTERM");
    expect(host.calls).toContain("taskkill /PID 200 /T /F");
  });

  it("reports a tracked process that survives every kill attempt", async () => {
    const host = createFakeHost({
      platform: "win32",
      processes: [...tree.slice(0, 3), { immortal: true, parentPid: 300, pid: 400 }],
      rootPid: 100,
    });

    const result = await stopProcessTree({ port: host.port, rootPid: 100 });

    expect(result.survivors).toEqual([400]);
    expect(result.verified).toBe(true);
    expect(host.alivePids()).toEqual([400]);
  });

  it("force-kills the tree without a graceful signal when the table is unavailable", async () => {
    // A graceful signal would orphan the subtree before it could be tracked, so
    // the force kill has to happen while the launcher still leads it.
    const host = createFakeHost({
      enumerable: false,
      platform: "win32",
      processes: tree,
      rootPid: 100,
    });

    const result = await stopProcessTree({ port: host.port, rootPid: 100 });

    expect(result).toMatchObject({
      descendants: { status: "skipped", reason: "enumeration-unavailable" },
      graceful: false,
      survivors: [],
      verified: false,
    });
    expect(host.calls).toEqual(["taskkill /PID 100 /T /F"]);
  });

  it("does not touch a table whose launcher has already exited", async () => {
    const host = createFakeHost({ platform: "win32", processes: [], rootPid: 100 });

    const result = await stopProcessTree({ port: host.port, rootPid: 100 });

    expect(result).toMatchObject({
      descendants: { status: "skipped", reason: "root-exited" },
      graceful: false,
      survivors: [],
      verified: false,
    });
    expect(host.calls).toEqual([]);
  });
});

describe("stopProcessTree on POSIX", () => {
  it("keeps signalling the launcher's process group", async () => {
    const host = createFakeHost({
      drainsGracefully: true,
      platform: "linux",
      processes: [{ parentPid: 1, pid: 100 }],
      rootPid: 100,
    });

    const result = await stopProcessTree({ port: host.port, rootPid: 100 });

    expect(result).toMatchObject({
      descendants: { status: "skipped", reason: "not-required" },
      graceful: true,
      strategy: "process-group",
      survivors: [],
    });
    expect(host.calls).toEqual(["group -100 SIGTERM"]);
  });

  it("escalates the whole group to SIGKILL when the group outlives the grace window", async () => {
    const host = createFakeHost({
      ignoresGracefulSignal: true,
      platform: "darwin",
      processes: [{ parentPid: 1, pid: 100 }],
      rootPid: 100,
    });

    const result = await stopProcessTree({ port: host.port, rootPid: 100 });

    expect(result).toMatchObject({ graceful: false, survivors: [], strategy: "process-group" });
    expect(host.calls).toEqual(["group -100 SIGTERM", "group -100 SIGKILL"]);
  });

  it("does not signal a group whose launcher has already exited", async () => {
    const host = createFakeHost({ platform: "linux", processes: [], rootPid: 100 });

    await stopProcessTree({ port: host.port, rootPid: 100 });

    expect(host.calls).toEqual([]);
  });
});

describe("removePathWithRetry", () => {
  it("retries the codes Windows raises while a handle is still open", async () => {
    const codes = ["EBUSY", "EPERM"];
    let attempts = 0;
    const removed: string[] = [];

    const result = await removePathWithRetry("C:\\scratch", {
      remove: async (path) => {
        attempts += 1;
        const code = codes.shift();
        if (code !== undefined) throw failure(code);
        removed.push(path);
      },
      sleep: async () => undefined,
    });

    expect(result).toEqual({ attempts: 3, reason: null, removed: true });
    expect(removed).toEqual(["C:\\scratch"]);
  });

  it("reports the retained path and reason instead of throwing", async () => {
    const result = await removePathWithRetry("C:\\scratch", {
      delaysMs: [1, 1],
      remove: async () => {
        throw failure("EBUSY");
      },
      sleep: async () => undefined,
    });

    expect(result.removed).toBe(false);
    expect(result.attempts).toBe(3);
    expect(result.reason).toContain("EBUSY");
  });

  it("stops immediately on a failure that retrying cannot fix", async () => {
    let attempts = 0;

    const result = await removePathWithRetry("C:\\scratch", {
      remove: async () => {
        attempts += 1;
        throw failure("EINVAL");
      },
      sleep: async () => undefined,
    });

    expect(result.removed).toBe(false);
    expect(attempts).toBe(1);
  });

  it("removes a real directory with the default primitive", async () => {
    const directory = await NodeFSP.mkdtemp(NodePath.join(NodeOS.tmpdir(), "t3code-teardown-"));
    await NodeFSP.writeFile(NodePath.join(directory, "state.sqlite"), "x", "utf8");

    const result = await removePathWithRetry(directory);

    expect(result).toEqual({ attempts: 1, reason: null, removed: true });
    await expect(NodeFSP.stat(directory)).rejects.toThrow();
  });
});

describe("runTeardownSteps", () => {
  it("runs every step and collects failures instead of throwing", async () => {
    const ran: string[] = [];

    const failures = await runTeardownSteps([
      { label: "first", run: () => void ran.push("first") },
      {
        label: "second",
        run: () => {
          ran.push("second");
          throw new Error("close failed");
        },
      },
      { label: "third", run: () => void ran.push("third") },
    ]);

    expect(ran).toEqual(["first", "second", "third"]);
    expect(failures).toHaveLength(1);
    expect(failures[0]?.label).toBe("second");
    expect(failures[0]?.error).toBeInstanceOf(Error);
  });

  it("awaits asynchronous steps in order", async () => {
    const ran: string[] = [];

    const failures = await runTeardownSteps([
      { label: "first", run: async () => void ran.push("first") },
      { label: "second", run: async () => void ran.push("second") },
    ]);

    expect(failures).toEqual([]);
    expect(ran).toEqual(["first", "second"]);
  });
});

describe("createProcessTreePort", () => {
  it("does not enumerate processes off win32", async () => {
    const port = createProcessTreePort({
      hasRootExited: () => false,
      platform: "linux",
      rootExited: Promise.resolve(),
    });

    expect(await port.listProcesses()).toBeNull();
  });

  it("reports the live table on a Windows host", async () => {
    const port = createProcessTreePort({
      hasRootExited: () => false,
      platform: "win32",
      rootExited: Promise.resolve(),
    });

    const table = await port.listProcesses();
    // Enumeration is Windows-only, so there is nothing to assert elsewhere.
    if (table === null) return;
    expect(table.some((entry) => entry.pid === process.pid)).toBe(true);
  });
});
