// @effect-diagnostics nodeBuiltinImport:off
// @effect-diagnostics globalTimers:off
import * as NodeHttp from "node:http";
import * as NodeFS from "node:fs/promises";
import * as NodePath from "node:path";

import { describe, expect, it } from "vite-plus/test";

import {
  LOCAL_DAEMON_PROTOCOL_VERSION,
  deriveLocalDaemonPaths,
  inspectLocalDaemon,
  makeLocalDaemonDiscovery,
  parseLocalDaemonDiscovery,
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
    const root = await NodeFS.mkdtemp(NodePath.join("/tmp", "acode-local-daemon-lock-"));
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

const writeDiscovery = async (baseDir: string, state: unknown) => {
  const paths = deriveLocalDaemonPaths(baseDir);
  await NodeFS.mkdir(paths.stateDir, { recursive: true });
  await NodeFS.writeFile(paths.runtimeStatePath, `${JSON.stringify(state)}\n`, "utf8");
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
    const malformedRoot = await NodeFS.mkdtemp(NodePath.join("/tmp", "acode-daemon-invalid-"));
    const malformedPaths = deriveLocalDaemonPaths(malformedRoot);
    await NodeFS.mkdir(malformedPaths.stateDir, { recursive: true });
    await NodeFS.writeFile(malformedPaths.runtimeStatePath, "{not-json", "utf8");
    await expect(inspectLocalDaemon(malformedRoot)).resolves.toMatchObject({ status: "invalid" });

    const staleRoot = await NodeFS.mkdtemp(NodePath.join("/tmp", "acode-daemon-stale-"));
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
      const root = await NodeFS.mkdtemp(NodePath.join("/tmp", "acode-daemon-foreign-"));
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
      const root = await NodeFS.mkdtemp(NodePath.join("/tmp", "acode-daemon-auth-"));
      const state = makeLocalDaemonDiscovery({
        daemonId: "auth-daemon",
        pid: process.pid,
        origin: server.origin,
        startedAt: "2026-09-18T00:00:00.000Z",
        workingDirectory: "/auth",
      });
      const paths = await writeDiscovery(root, state);
      await NodeFS.mkdir(NodePath.dirname(paths.credentialPath), { recursive: true });
      await NodeFS.writeFile(paths.credentialPath, "invalid-token\n", { mode: 0o600 });

      await expect(inspectLocalDaemon(root)).resolves.toMatchObject({ status: "auth-invalid" });
      await expect(NodeFS.readFile(paths.credentialPath, "utf8")).resolves.toBe("invalid-token\n");
    } finally {
      await server.close();
    }
  });
});
