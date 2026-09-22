// @effect-diagnostics nodeBuiltinImport:off - Tests exercise the host process-tree boundary through fake ports.

import { describe, expect, it } from "vite-plus/test";

import {
  collectProcessTree,
  createProcessTreePort,
  stopProcessTree,
  type ProcessTableEntry,
  type ProcessTreePort,
} from "./process-tree.ts";

interface FakeProcess {
  pid: number;
  parentPid: number;
  createdAt: number;
  /** Survives every kill attempt, standing in for a leaked handle holder. */
  immortal?: boolean;
}

interface FakeControls {
  readonly processes: FakeProcess[];
  readonly setEnumerable: (value: boolean) => void;
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
  /** Lets a test change the table between reads, which is where pids get reused. */
  readonly onTableRead?: (readIndex: number, controls: FakeControls) => void;
}): FakeHost {
  const calls: string[] = [];
  const processes = input.processes.map((entry) => ({ ...entry }));
  const enumerable = { value: input.enumerable ?? true };
  let reads = 0;
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
    if (index >= 0 && processes[index]?.immortal !== true) processes.splice(index, 1);
    settle();
  };

  /** A force kill or a process-group signal takes the whole subtree. */
  const removeSubtree = (pid: number): void => {
    for (const target of [pid, ...childPidsOf(pid)]) {
      const index = processes.findIndex((entry) => entry.pid === target);
      if (index < 0 || processes[index]?.immortal === true) continue;
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
      listProcesses: async (): Promise<ReadonlyArray<ProcessTableEntry> | null> => {
        reads += 1;
        input.onTableRead?.(reads, {
          processes,
          setEnumerable: (value) => {
            enumerable.value = value;
          },
        });
        if (!enumerable.value) return null;
        return processes.map(({ createdAt, parentPid, pid }) => ({ createdAt, parentPid, pid }));
      },
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

/** Launcher `100` with three generations below it, oldest first. */
const launcherTree: ReadonlyArray<FakeProcess> = [
  { createdAt: 1_000, parentPid: 1, pid: 100 },
  { createdAt: 2_000, parentPid: 100, pid: 200 },
  { createdAt: 3_000, parentPid: 200, pid: 300 },
  { createdAt: 4_000, parentPid: 300, pid: 400 },
];

const trackedTree = [100, 200, 300, 400];

describe("collectProcessTree", () => {
  it("collects the launcher and its whole subtree, ignoring unrelated branches", () => {
    const entries: ReadonlyArray<ProcessTableEntry> = [
      { createdAt: 1_000, parentPid: 1, pid: 100 },
      { createdAt: 2_000, parentPid: 100, pid: 200 },
      { createdAt: 3_000, parentPid: 200, pid: 300 },
      { createdAt: 4_000, parentPid: 300, pid: 400 },
      { createdAt: 1_500, parentPid: 1, pid: 900 },
      { createdAt: 1_600, parentPid: 900, pid: 901 },
    ];

    expect(collectProcessTree(100, entries)).toEqual(trackedTree);
  });

  it("returns only the launcher when the table no longer links its descendants", () => {
    const entries: ReadonlyArray<ProcessTableEntry> = [
      { createdAt: 2_000, parentPid: 1, pid: 200 },
      { createdAt: 3_000, parentPid: 200, pid: 300 },
    ];

    expect(collectProcessTree(100, entries)).toEqual([100]);
  });

  it("drops a candidate that predates the process it claims as its parent", () => {
    // Windows never reparents an orphan: the field keeps naming a dead pid, and
    // a reused pid makes that stale link look like a live child. A process that
    // started before its claimed parent did cannot be that parent's child, and
    // must not be reported as part of this run's tree.
    const entries: ReadonlyArray<ProcessTableEntry> = [
      { createdAt: 5_000, parentPid: 1, pid: 100 },
      { createdAt: 200, parentPid: 100, pid: 900 },
      { createdAt: 5_100, parentPid: 100, pid: 200 },
    ];

    expect(collectProcessTree(100, entries)).toEqual([100, 200]);
  });

  it("terminates on a table that links a process to itself", () => {
    expect(collectProcessTree(100, [{ createdAt: 1_000, parentPid: 100, pid: 100 }])).toEqual([
      100,
    ]);
  });
});

describe("stopProcessTree on win32", () => {
  it("kills the launcher's tree once, and never re-issues a kill per observed pid", async () => {
    // `SIGTERM` on Windows terminates the launcher outright and cannot be
    // handled, so signalling first would only orphan the subtree and put it out
    // of `taskkill /T`'s reach. The host's own walk of the live tree is the
    // whole kill; chasing pids afterwards would mean killing on identity this
    // process inferred from parent links Windows cannot promise.
    const host = createFakeHost({ platform: "win32", processes: launcherTree, rootPid: 100 });

    const result = await stopProcessTree({ port: host.port, rootPid: 100 });

    expect(result).toMatchObject({
      descendants: { status: "observed", tracked: trackedTree },
      survivors: [],
      termination: "forced",
      verified: true,
    });
    expect(host.calls).toEqual(["taskkill /PID 100 /T /F"]);
    expect(host.alivePids()).toEqual([]);
  });

  it("reports a process that outlives the kill instead of chasing it by pid", async () => {
    const host = createFakeHost({
      platform: "win32",
      processes: [
        ...launcherTree.slice(0, 3),
        { createdAt: 4_000, immortal: true, parentPid: 300, pid: 400 },
      ],
      rootPid: 100,
    });

    const result = await stopProcessTree({ port: host.port, rootPid: 100 });

    expect(result.survivors).toEqual([400]);
    expect(result.verified).toBe(true);
    expect(host.alivePids()).toEqual([400]);
    expect(host.calls).toEqual(["taskkill /PID 100 /T /F"]);
  });

  it("does not report a pid that was reused by a different process", async () => {
    // The table is read before the kill, so a pid in it can stop naming the same
    // process before it is inspected. A reused number is not a survivor.
    const host = createFakeHost({
      onTableRead: (readIndex, { processes }) => {
        if (readIndex !== 2) return;
        for (const entry of processes) {
          if (entry.pid === 400) entry.createdAt = 999_999;
        }
      },
      platform: "win32",
      processes: [
        ...launcherTree.slice(0, 3),
        { createdAt: 4_000, immortal: true, parentPid: 300, pid: 400 },
      ],
      rootPid: 100,
    });

    const result = await stopProcessTree({ port: host.port, rootPid: 100 });

    expect(result.survivors).toEqual([]);
    expect(result.verified).toBe(true);
    expect(host.alivePids()).toContain(400);
  });

  it("force-kills the launcher's tree when the table is unavailable", async () => {
    const host = createFakeHost({
      enumerable: false,
      platform: "win32",
      processes: launcherTree,
      rootPid: 100,
    });

    const result = await stopProcessTree({ port: host.port, rootPid: 100 });

    expect(result).toMatchObject({
      descendants: { status: "skipped", reason: "enumeration-unavailable" },
      survivors: [],
      termination: "forced",
      verified: false,
    });
    expect(host.calls).toEqual(["taskkill /PID 100 /T /F"]);
  });

  it("does not touch a table whose launcher has already exited", async () => {
    const host = createFakeHost({ platform: "win32", processes: [], rootPid: 100 });

    const result = await stopProcessTree({ port: host.port, rootPid: 100 });

    expect(result).toMatchObject({
      descendants: { status: "skipped", reason: "root-exited" },
      survivors: [],
      termination: "none",
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
      processes: [{ createdAt: 1_000, parentPid: 1, pid: 100 }],
      rootPid: 100,
    });

    const result = await stopProcessTree({ port: host.port, rootPid: 100 });

    expect(result).toMatchObject({
      descendants: { status: "skipped", reason: "not-required" },
      strategy: "process-group",
      survivors: [],
      termination: "graceful",
    });
    expect(host.calls).toEqual(["group -100 SIGTERM"]);
  });

  it("escalates the whole group to SIGKILL when the group outlives the grace window", async () => {
    const host = createFakeHost({
      ignoresGracefulSignal: true,
      platform: "darwin",
      processes: [{ createdAt: 1_000, parentPid: 1, pid: 100 }],
      rootPid: 100,
    });

    const result = await stopProcessTree({ port: host.port, rootPid: 100 });

    expect(result).toMatchObject({
      survivors: [],
      strategy: "process-group",
      termination: "forced",
    });
    expect(host.calls).toEqual(["group -100 SIGTERM", "group -100 SIGKILL"]);
  });

  it("does not signal a group whose launcher has already exited", async () => {
    const host = createFakeHost({ platform: "linux", processes: [], rootPid: 100 });

    const result = await stopProcessTree({ port: host.port, rootPid: 100 });

    expect(result.termination).toBe("none");
    expect(host.calls).toEqual([]);
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

  it("dates every process it reports on win32", async () => {
    const port = createProcessTreePort({
      hasRootExited: () => false,
      platform: "win32",
      rootExited: Promise.resolve(),
    });

    const table = await port.listProcesses();
    // Enumeration is Windows-only, so there is nothing to assert elsewhere.
    if (table === null) return;
    expect(table.find((entry) => entry.pid === process.pid)?.createdAt).toBeGreaterThan(0);
  });
});
