// @effect-diagnostics nodeBuiltinImport:off
// @effect-diagnostics globalTimers:off
import * as NodeChildProcess from "node:child_process";
import * as NodeHttp from "node:http";
import * as NodeFSP from "node:fs/promises";
import * as NodeNet from "node:net";
import * as NodePath from "node:path";

import { describe, expect, it } from "vite-plus/test";

import {
  LOCAL_DAEMON_PROTOCOL_VERSION,
  deriveLocalDaemonPaths,
  inspectLocalDaemon,
  makeLocalDaemonDiscovery,
  parseLocalDaemonDiscovery,
  requestedDaemonPort,
  startLocalDaemon,
  withLocalDaemonLaunchLock,
} from "./localDaemon.ts";

describe("local daemon discovery", () => {
  it("uses one state root and keeps credential paths out of discovery records", async () => {
    const baseDir = NodePath.join("/tmp", "ACode path with spaces");
    const paths = deriveLocalDaemonPaths(baseDir);
    const discovery = makeLocalDaemonDiscovery({
      daemonId: "daemon-1",
      pid: 321,
      origin: "http://127.0.0.1:43123/",
      startedAt: "2026-09-18T00:00:00.000Z",
      workingDirectory: "/worktree with spaces",
    });

    expect(paths.stateDir).toBe(NodePath.join(baseDir, "userdata"));
    expect(paths.runtimeStatePath).toBe(NodePath.join(baseDir, "userdata", "server-runtime.json"));
    expect(paths.credentialPath).toBe(
      NodePath.join(baseDir, "userdata", "secrets", "desktop-bootstrap.token"),
    );
    expect(discovery).toEqual({
      version: 1,
      daemonProtocolVersion: LOCAL_DAEMON_PROTOCOL_VERSION,
      daemonId: "daemon-1",
      daemonOwner: "acode-local-daemon",
      daemonWorkingDirectory: "/worktree with spaces",
      daemonManaged: true,
      pid: 321,
      origin: "http://127.0.0.1:43123/",
      startedAt: "2026-09-18T00:00:00.000Z",
    });
    expect(JSON.stringify(discovery)).not.toContain("desktop-bootstrap.token");
  });

  it("rejects records that cannot prove daemon ownership", () => {
    expect(
      parseLocalDaemonDiscovery({
        version: 1,
        daemonProtocolVersion: LOCAL_DAEMON_PROTOCOL_VERSION,
        daemonId: "daemon-1",
        daemonOwner: "acode-local-daemon",
        daemonWorkingDirectory: "/worktree",
        daemonManaged: true,
        pid: 321,
        origin: "http://127.0.0.1:43123",
        startedAt: "2026-09-18T00:00:00.000Z",
      }),
    ).toBeDefined();

    expect(
      parseLocalDaemonDiscovery({
        version: 1,
        pid: 321,
        origin: "http://127.0.0.1:43123",
      }),
    ).toBeUndefined();
    expect(
      parseLocalDaemonDiscovery({
        version: 1,
        daemonProtocolVersion: LOCAL_DAEMON_PROTOCOL_VERSION,
        daemonId: "daemon-1",
        daemonManaged: true,
        pid: 321,
        origin: "http://192.168.1.10:43123",
        startedAt: "2026-09-18T00:00:00.000Z",
      }),
    ).toBeUndefined();
  });
});

describe("local daemon launch lock", () => {
  it("serializes concurrent work for one data root", async () => {
    const root = await NodeFSP.mkdtemp(NodePath.join("/tmp", "acode-local-daemon-lock-"));
    const order: string[] = [];

    const first = withLocalDaemonLaunchLock(root, async () => {
      order.push("first-enter");
      await new Promise((resolve) => setTimeout(resolve, 20));
      order.push("first-exit");
    });
    const second = withLocalDaemonLaunchLock(root, async () => {
      order.push("second-enter");
      order.push("second-exit");
    });

    await Promise.all([first, second]);
    expect(
      order.join(",") === "first-enter,first-exit,second-enter,second-exit" ||
        order.join(",") === "second-enter,second-exit,first-enter,first-exit",
    ).toBe(true);
  });
});

describe("requested daemon port", () => {
  it("treats daemon-specific keys as contracts and the server port as a preference", () => {
    expect(requestedDaemonPort({ ACODE_DAEMON_PORT: "13773" })).toEqual({
      port: 13_773,
      required: true,
      source: "ACODE_DAEMON_PORT",
    });
    expect(requestedDaemonPort({ T3CODE_DAEMON_PORT: "13773" })).toEqual({
      port: 13_773,
      required: true,
      source: "T3CODE_DAEMON_PORT",
    });
    // `T3CODE_PORT` is the web dev runner's general server port: a leftover
    // listener must not stop `pnpm dev` from taking a free port instead.
    expect(requestedDaemonPort({ T3CODE_PORT: "13773" })).toEqual({
      port: 13_773,
      required: false,
      source: "T3CODE_PORT",
    });
    expect(requestedDaemonPort({})).toEqual({
      port: undefined,
      required: false,
      source: undefined,
    });
  });

  it("keeps the documented precedence and skips blank values", () => {
    expect(
      requestedDaemonPort({
        ACODE_DAEMON_PORT: "1111",
        ACODE_PORT: "2222",
        T3CODE_DAEMON_PORT: "3333",
        T3CODE_PORT: "4444",
      }).source,
    ).toBe("ACODE_DAEMON_PORT");
    expect(requestedDaemonPort({ ACODE_DAEMON_PORT: "  ", T3CODE_PORT: "4444" }).source).toBe(
      "T3CODE_PORT",
    );
  });

  it("rejects an unusable value instead of silently ignoring it", () => {
    expect(() => requestedDaemonPort({ ACODE_DAEMON_PORT: "not-a-port" })).toThrowError(
      /must be a port number between 1 and 65535/,
    );
    expect(() => requestedDaemonPort({ T3CODE_PORT: "0" })).toThrowError(
      /must be a port number between 1 and 65535/,
    );
  });
});

const writeDiscovery = async (baseDir: string, state: unknown) => {
  const paths = deriveLocalDaemonPaths(baseDir);
  await NodeFSP.mkdir(paths.stateDir, { recursive: true });
  await NodeFSP.writeFile(paths.runtimeStatePath, `${JSON.stringify(state)}\n`, "utf8");
  return paths;
};

const listenForHandshake = async (
  handler: (request: import("node:http").IncomingMessage) => {
    readonly status: number;
    readonly body: unknown;
  },
) => {
  const server = NodeHttp.createServer((request, response) => {
    const result = handler(request);
    response.writeHead(result.status, { "content-type": "application/json" });
    response.end(JSON.stringify(result.body));
  });
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => resolve());
  });
  const address = server.address();
  if (typeof address !== "object" || address === null) {
    await new Promise<void>((resolve) => server.close(() => resolve()));
    throw new Error("test server did not expose a TCP address");
  }
  return {
    origin: `http://127.0.0.1:${String(address.port)}`,
    close: () => new Promise<void>((resolve) => server.close(() => resolve())),
  };
};

describe("local daemon discovery diagnostics", () => {
  it("diagnoses malformed and stale records without starting a process", async () => {
    const malformedRoot = await NodeFSP.mkdtemp(NodePath.join("/tmp", "acode-daemon-invalid-"));
    const malformedPaths = deriveLocalDaemonPaths(malformedRoot);
    await NodeFSP.mkdir(malformedPaths.stateDir, { recursive: true });
    await NodeFSP.writeFile(malformedPaths.runtimeStatePath, "{not-json", "utf8");
    await expect(inspectLocalDaemon(malformedRoot)).resolves.toMatchObject({ status: "invalid" });

    const staleRoot = await NodeFSP.mkdtemp(NodePath.join("/tmp", "acode-daemon-stale-"));
    const stale = makeLocalDaemonDiscovery({
      daemonId: "stale-daemon",
      pid: 2_147_483_647,
      origin: "http://127.0.0.1:43123",
      startedAt: "2026-09-18T00:00:00.000Z",
      workingDirectory: "/stale",
    });
    await writeDiscovery(staleRoot, stale);
    await expect(inspectLocalDaemon(staleRoot)).resolves.toMatchObject({ status: "stale" });
  });

  it("rejects a live foreign process at the recorded endpoint", async () => {
    const server = await listenForHandshake(() => ({
      status: 200,
      body: {
        protocolVersion: LOCAL_DAEMON_PROTOCOL_VERSION,
        owner: "acode-local-daemon",
        daemonId: "foreign-daemon",
        pid: process.pid,
        managed: true,
      },
    }));
    try {
      const root = await NodeFSP.mkdtemp(NodePath.join("/tmp", "acode-daemon-foreign-"));
      const state = makeLocalDaemonDiscovery({
        daemonId: "expected-daemon",
        pid: process.pid,
        origin: server.origin,
        startedAt: "2026-09-18T00:00:00.000Z",
        workingDirectory: "/foreign",
      });
      await writeDiscovery(root, state);
      await expect(inspectLocalDaemon(root, { verifyCredential: false })).resolves.toMatchObject({
        status: "foreign",
      });
    } finally {
      await server.close();
    }
  });

  it("diagnoses a rejected credential without replacing it", async () => {
    const server = await listenForHandshake((request) => ({
      status: request.url === "/.well-known/acode/daemon" ? 200 : 401,
      body:
        request.url === "/.well-known/acode/daemon"
          ? {
              protocolVersion: LOCAL_DAEMON_PROTOCOL_VERSION,
              owner: "acode-local-daemon",
              daemonId: "auth-daemon",
              pid: process.pid,
              managed: true,
            }
          : { error: "auth_invalid" },
    }));
    try {
      const root = await NodeFSP.mkdtemp(NodePath.join("/tmp", "acode-daemon-auth-"));
      const state = makeLocalDaemonDiscovery({
        daemonId: "auth-daemon",
        pid: process.pid,
        origin: server.origin,
        startedAt: "2026-09-18T00:00:00.000Z",
        workingDirectory: "/auth",
      });
      const paths = await writeDiscovery(root, state);
      await NodeFSP.mkdir(NodePath.dirname(paths.credentialPath), { recursive: true });
      await NodeFSP.writeFile(paths.credentialPath, "invalid-token\n", { mode: 0o600 });

      await expect(inspectLocalDaemon(root)).resolves.toMatchObject({ status: "auth-invalid" });
      await expect(NodeFSP.readFile(paths.credentialPath, "utf8")).resolves.toBe("invalid-token\n");
    } finally {
      await server.close();
    }
  });

  it("resolves credential path under secrets directory", async () => {
    const root = await NodeFSP.mkdtemp(NodePath.join("/tmp", "acode-daemon-paths-"));
    const paths = deriveLocalDaemonPaths(root);
    expect(paths.credentialPath).toBe(
      NodePath.join(root, "userdata", "secrets", "desktop-bootstrap.token"),
    );
  });
});

const spawnIdleProcess = async (): Promise<NodeChildProcess.ChildProcess> => {
  const child = NodeChildProcess.spawn(process.execPath, ["-e", "setInterval(() => {}, 1000)"], {
    stdio: "ignore",
  });
  await new Promise<void>((resolve, reject) => {
    child.once("spawn", resolve);
    child.once("error", reject);
  });
  return child;
};

const processIsAlive = (pid: number): boolean => {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
};

const listenOnLoopback = async (): Promise<{ port: number; close: () => Promise<void> }> => {
  const server = NodeNet.createServer();
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => resolve());
  });
  const address = server.address();
  if (typeof address !== "object" || address === null) {
    await new Promise<void>((resolve) => server.close(() => resolve()));
    throw new Error("probe listener did not expose a TCP address");
  }
  return {
    port: address.port,
    close: () => new Promise<void>((resolve) => server.close(() => resolve())),
  };
};

describe("local daemon port contract", () => {
  it("refuses to drift to a free port when an explicit daemon port is taken", async () => {
    const root = await NodeFSP.mkdtemp(NodePath.join("/tmp", "acode-daemon-strict-port-"));
    const holder = await listenOnLoopback();
    const previous = process.env.ACODE_DAEMON_PORT;
    process.env.ACODE_DAEMON_PORT = String(holder.port);
    try {
      // A daemon on another port leaves the desktop shell and the web dev proxy
      // dialing a port nothing serves: fail loudly instead.
      await expect(startLocalDaemon({ baseDir: root })).rejects.toMatchObject({
        code: "daemon-port-unavailable",
      });
    } finally {
      if (previous === undefined) delete process.env.ACODE_DAEMON_PORT;
      else process.env.ACODE_DAEMON_PORT = previous;
      await holder.close();
    }
  });

  // A start that cannot honour the required port must fail without taking the
  // daemon that is running on another port with it. Reconciliation stops that
  // daemon before reserving the replacement port, so the port is validated first;
  // otherwise a foreign process holding 13773 left the developer with no daemon at
  // all instead of a working one plus a clear error.
  it("leaves the running daemon alone when the required port is unavailable", async () => {
    const root = await NodeFSP.mkdtemp(NodePath.join("/tmp", "acode-daemon-keep-old-"));
    const running = await spawnIdleProcess();
    const pid = running.pid;
    if (pid === undefined) throw new Error("idle holder did not expose a pid");
    const server = await listenForHandshake(() => ({
      status: 200,
      body: {
        protocolVersion: LOCAL_DAEMON_PROTOCOL_VERSION,
        owner: "acode-local-daemon",
        daemonId: "running-daemon",
        pid,
        managed: true,
      },
    }));
    const taken = await listenOnLoopback();
    const previousPort = process.env.ACODE_DAEMON_PORT;
    process.env.ACODE_DAEMON_PORT = String(taken.port);
    try {
      const paths = await writeDiscovery(
        root,
        makeLocalDaemonDiscovery({
          daemonId: "running-daemon",
          pid,
          origin: server.origin,
          startedAt: "2026-09-18T00:00:00.000Z",
          workingDirectory: "/running",
        }),
      );
      await NodeFSP.mkdir(NodePath.dirname(paths.credentialPath), { recursive: true });
      await NodeFSP.writeFile(paths.credentialPath, "bootstrap-token\n", { mode: 0o600 });

      await expect(startLocalDaemon({ baseDir: root })).rejects.toMatchObject({
        code: "daemon-port-unavailable",
      });

      expect(processIsAlive(pid)).toBe(true);
      await expect(NodeFSP.readFile(paths.runtimeStatePath, "utf8")).resolves.toContain(
        "running-daemon",
      );
    } finally {
      if (previousPort === undefined) delete process.env.ACODE_DAEMON_PORT;
      else process.env.ACODE_DAEMON_PORT = previousPort;
      running.kill("SIGKILL");
      await server.close();
      await taken.close();
    }
  });

  // The reconciliation path used to nest `stopLocalDaemon` inside a held launch
  // lock. The lock record names the holding pid — here, our own — so the nested
  // acquisition could never break it and only ended in `launch-lock-timeout`
  // after LOCK_TIMEOUT_MS, leaving the outdated daemon running, its descriptor in
  // place, and the proxy pointing at a port nothing served.
  it("stops a daemon on another port instead of deadlocking on its own launch lock", async () => {
    const root = await NodeFSP.mkdtemp(NodePath.join("/tmp", "acode-daemon-reconcile-"));
    const outdated = await spawnIdleProcess();
    const pid = outdated.pid;
    if (pid === undefined) throw new Error("idle holder did not expose a pid");
    const server = await listenForHandshake(() => ({
      status: 200,
      body: {
        protocolVersion: LOCAL_DAEMON_PROTOCOL_VERSION,
        owner: "acode-local-daemon",
        daemonId: "outdated-daemon",
        pid,
        managed: true,
      },
    }));
    const previousPort = process.env.T3CODE_PORT;
    // Any port other than the recorded daemon's own moves the launcher onto the
    // reconciliation path.
    process.env.T3CODE_PORT = String(Number(new URL(server.origin).port) + 1);
    try {
      const paths = await writeDiscovery(
        root,
        makeLocalDaemonDiscovery({
          daemonId: "outdated-daemon",
          pid,
          origin: server.origin,
          startedAt: "2026-09-18T00:00:00.000Z",
          workingDirectory: "/outdated",
        }),
      );
      // A launcher start verifies the recorded daemon's credential before it
      // reconciles, so the fake daemon needs one on disk.
      await NodeFSP.mkdir(NodePath.dirname(paths.credentialPath), { recursive: true });
      await NodeFSP.writeFile(paths.credentialPath, "bootstrap-token\n", { mode: 0o600 });

      // The injected reserve step replaces spawning the replacement daemon:
      // reaching it at all proves the launcher got past the stop without spinning
      // on the launch lock it already holds.
      const reserved = new Error("reservePort reached");
      const failure: unknown = await startLocalDaemon({
        baseDir: root,
        requestTimeoutMs: 250,
        reservePort: () => Promise.reject(reserved),
      }).catch((cause: unknown) => cause);

      expect(failure).toBe(reserved);
      expect(processIsAlive(pid)).toBe(false);
      await expect(
        NodeFSP.readFile(deriveLocalDaemonPaths(root).runtimeStatePath, "utf8"),
      ).rejects.toThrowError(/ENOENT/);
    } finally {
      if (previousPort === undefined) delete process.env.T3CODE_PORT;
      else process.env.T3CODE_PORT = previousPort;
      outdated.kill("SIGKILL");
      await server.close();
    }
  });
});
