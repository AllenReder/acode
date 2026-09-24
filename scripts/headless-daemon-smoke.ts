#!/usr/bin/env node
// @effect-diagnostics nodeBuiltinImport:off globalTimers:off globalFetch:off globalConsole:off globalConsoleInEffect:off globalDateInEffect:off
/**
 * Automated acceptance smoke test for headless Linux Awen daemon (Ticket C20).
 * Tests:
 *   1. Background detached daemon start (`daemon start`)
 *   2. Status query (`daemon status`)
 *   3. Unauthenticated Environment descriptor reading (`/api/environment/descriptor`)
 *   4. Token generation (`auth pairing create`) and bootstrap token (`daemon token`)
 *   5. Client-runtime Bearer authentication (`bootstrapRemoteBearerSession`)
 *   6. WebSocket connection and server probe via typed RPC
 *   7. Workspace association and query
 *   8. Session detachment persistence (daemon continues across client disconnection)
 *   9. Graceful shutdown (`daemon stop --confirm`) and absent status verification
 */
import * as NodeChildProcess from "node:child_process";
import * as NodeFSP from "node:fs/promises";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";

import {
  bootstrapRemoteBearerSession,
  fetchRemoteSessionState,
  issueRemoteWebSocketTicket,
} from "@awen/client-runtime/authorization";
import { fetchRemoteEnvironmentDescriptor } from "@awen/client-runtime/environment";
import {
  BearerConnectionProfile,
  BearerConnectionTarget,
  ConnectionDriver,
  ConnectionTransientError,
  Connectivity,
  makeEnvironmentSupervisor,
  type ConnectionCatalogEntry,
  type PreparedConnection,
  type SupervisorConnectionState,
  Wakeups,
} from "@awen/client-runtime/connection";
import {
  remoteHttpClientLayer,
  RpcSessionFactory,
  rpcSessionLayer,
} from "@awen/client-runtime/rpc";
import {
  AuthStandardClientScopes,
  CommandId,
  ORCHESTRATION_WS_METHODS,
  ProjectId,
  WS_METHODS,
} from "@awen/contracts";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as ManagedRuntime from "effect/ManagedRuntime";
import * as Option from "effect/Option";
import * as Socket from "effect/unstable/socket/Socket";
import * as Stream from "effect/Stream";
import * as SubscriptionRef from "effect/SubscriptionRef";

const REPOSITORY_ROOT = NodePath.resolve(import.meta.dirname, "..");
const SERVER_BINARY = NodePath.join(REPOSITORY_ROOT, "apps/server/dist/bin.mjs");
const READY_TIMEOUT_MS = 30_000;

function runCliJson(args: string[], cwd: string, env: NodeJS.ProcessEnv): any {
  const result = NodeChildProcess.execFileSync(
    process.execPath,
    [SERVER_BINARY, ...args, "--json"],
    {
      cwd,
      env,
      encoding: "utf8",
    },
  );
  return JSON.parse(result.trim());
}

async function waitForSupervisorState(
  supervisor: any,
  predicate: (phase: SupervisorConnectionState["phase"]) => boolean,
  description: string,
): Promise<SupervisorConnectionState> {
  for (let attempt = 0; attempt < READY_TIMEOUT_MS / 100; attempt += 1) {
    const state = (await SubscriptionRef.get(supervisor.state).pipe(
      Effect.runPromise,
    )) as SupervisorConnectionState;
    if (predicate(state.phase)) return state;
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error(`Timed out waiting for supervisor state: ${description}.`);
}

async function main(): Promise<void> {
  console.log("=== Awen Headless Daemon Smoke Test (C20) ===");

  const scratchDir = await NodeFSP.mkdtemp(NodePath.join(NodeOS.tmpdir(), "awen-c20-smoke-"));
  const awenHome = NodePath.join(scratchDir, ".awen");
  const testRepoDir = NodePath.join(scratchDir, "test-repo");

  // Create a test git repository for Workspace association
  await NodeFSP.mkdir(testRepoDir, { recursive: true });
  NodeChildProcess.execSync("git init -b main", { cwd: testRepoDir, stdio: "ignore" });
  NodeChildProcess.execSync('git config user.name "Smoke Test"', {
    cwd: testRepoDir,
    stdio: "ignore",
  });
  NodeChildProcess.execSync('git config user.email "smoke@awen.test"', {
    cwd: testRepoDir,
    stdio: "ignore",
  });
  await NodeFSP.writeFile(NodePath.join(testRepoDir, "README.md"), "# Smoke Test Workspace\n");
  NodeChildProcess.execSync("git add README.md && git commit -m 'Initial commit'", {
    cwd: testRepoDir,
    stdio: "ignore",
  });

  const env: NodeJS.ProcessEnv = {
    ...process.env,
    AWEN_HOME: awenHome,
    AWEN_LOG_LEVEL: "Error",
    AWEN_NO_BROWSER: "1",
    AWEN_AUTO_BOOTSTRAP_PROJECT_FROM_CWD: "0",
  };

  try {
    // 1. Start daemon in background via `daemon start`
    console.log("1. Starting Awen daemon in background (detached)...");
    const startOutput = runCliJson(
      ["daemon", "start", "--base-dir", awenHome],
      REPOSITORY_ROOT,
      env,
    );
    console.log("   Start output:", startOutput);
    if (!startOutput.ok || !startOutput.pid || !startOutput.origin) {
      throw new Error(`Daemon start failed: ${JSON.stringify(startOutput)}`);
    }
    const daemonPid = startOutput.pid;
    const origin = startOutput.origin.replace(/\/$/, "");

    // 2. Query status
    console.log("2. Querying daemon status...");
    const statusOutput = runCliJson(
      ["daemon", "status", "--base-dir", awenHome],
      REPOSITORY_ROOT,
      env,
    );
    console.log("   Status output:", statusOutput);
    if (
      !statusOutput.ok ||
      statusOutput.status !== "ready" ||
      statusOutput.state.pid !== daemonPid
    ) {
      throw new Error(`Daemon status check failed: ${JSON.stringify(statusOutput)}`);
    }

    // 3. Verify public environment descriptor without authentication
    console.log("3. Verifying unauthenticated /api/environment/descriptor...");
    const httpRuntime = ManagedRuntime.make(remoteHttpClientLayer(globalThis.fetch));
    const descriptor = await httpRuntime.runPromise(
      fetchRemoteEnvironmentDescriptor({ httpBaseUrl: origin }),
    );
    console.log(
      `   Descriptor verified: id=${descriptor.environmentId}, os=${descriptor.platform.os}, version=${descriptor.serverVersion}`,
    );
    if (!descriptor.environmentId || !descriptor.capabilities.workspaceManagement) {
      throw new Error("Invalid environment descriptor returned from daemon.");
    }

    // 4. Generate pairing token and verify bootstrap token
    console.log("4. Testing token generation via CLI...");
    const pairingOutput = runCliJson(
      ["auth", "pairing", "create", "--base-dir", awenHome],
      REPOSITORY_ROOT,
      env,
    );
    console.log(`   Pairing token issued: credential=${pairingOutput.credential.slice(0, 4)}...`);
    if (!pairingOutput.credential) {
      throw new Error("Failed to issue pairing credential.");
    }

    const tokenOutput = runCliJson(
      ["daemon", "token", "--base-dir", awenHome],
      REPOSITORY_ROOT,
      env,
    );
    console.log("   Daemon bootstrap token command returned successfully.");
    if (!tokenOutput.ok || !tokenOutput.token) {
      throw new Error("Failed to read daemon bootstrap token.");
    }

    // 5. Authenticate via client-runtime
    console.log("5. Authenticating client-runtime session with pairing token...");
    const access = await httpRuntime.runPromise(
      bootstrapRemoteBearerSession({
        httpBaseUrl: origin,
        credential: pairingOutput.credential,
        scopes: AuthStandardClientScopes,
        clientMetadata: { label: "Awen C20 Headless Smoke", deviceType: "bot" },
      }),
    );
    const sessionState = await httpRuntime.runPromise(
      fetchRemoteSessionState({ httpBaseUrl: origin, bearerToken: access.token }),
    );
    if (!sessionState.authenticated || sessionState.sessionMethod !== "bearer-access-token") {
      throw new Error("Authenticated session validation failed.");
    }
    console.log("   Authenticated session established successfully.");

    // 6. Connect WebSocket and verify typed RPC
    console.log("6. Establishing WebSocket RPC connection via EnvironmentSupervisor...");
    const wsBaseUrl = new URL(origin);
    wsBaseUrl.protocol = "ws:";
    wsBaseUrl.pathname = "/ws";

    const target = new BearerConnectionTarget({
      environmentId: descriptor.environmentId,
      label: descriptor.label,
      connectionId: "awen-c20-smoke-connection",
    });
    const profile = new BearerConnectionProfile({
      connectionId: target.connectionId,
      environmentId: target.environmentId,
      label: target.label,
      httpBaseUrl: origin,
      wsBaseUrl: wsBaseUrl.toString(),
    });
    const catalogEntry: ConnectionCatalogEntry = {
      target,
      profile: Option.some(profile),
      enabled: true,
    };

    const sessionRuntime = ManagedRuntime.make(
      rpcSessionLayer({}).pipe(Layer.provide(Socket.layerWebSocketConstructorGlobal)),
    );

    const issueTicket = () =>
      httpRuntime.runPromise(
        issueRemoteWebSocketTicket({
          httpBaseUrl: origin,
          bearerToken: access.token,
        }),
      );

    const driverLayer = Layer.effect(
      ConnectionDriver,
      Effect.gen(function* () {
        const sessions = yield* RpcSessionFactory;
        return ConnectionDriver.of({
          connect: (entry, reportProgress) =>
            Effect.gen(function* () {
              yield* reportProgress({ stage: "preparing" });
              const ticket = yield* Effect.tryPromise({
                try: issueTicket,
                catch: (cause) =>
                  new ConnectionTransientError({
                    reason: "transport",
                    detail: String(cause),
                  }),
              });
              const socketUrl = new URL(wsBaseUrl.toString());
              socketUrl.searchParams.set("wsTicket", ticket.ticket);
              const prepared: PreparedConnection = {
                environmentId: entry.target.environmentId,
                label: entry.target.label,
                httpBaseUrl: origin,
                socketUrl: socketUrl.toString(),
                httpAuthorization: { _tag: "Bearer", token: access.token },
                target: entry.target,
              };
              yield* reportProgress({ stage: "opening", prepared });
              const session = yield* sessions.connect(prepared);
              yield* reportProgress({ stage: "synchronizing", prepared });
              yield* session.ready;
              return { prepared, session };
            }),
        });
      }),
    );

    const supervisorLayer = Layer.mergeAll(
      driverLayer,
      Connectivity.layer({ status: Effect.succeed("online"), changes: Stream.empty }),
      Wakeups.layer({ changes: Stream.empty }),
    );

    await sessionRuntime.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const supervisor = yield* makeEnvironmentSupervisor(catalogEntry, {
            initiallyDesired: true,
          });
          yield* Effect.promise(() =>
            waitForSupervisorState(supervisor, (phase) => phase === "connected", "connected"),
          );
          const sessionOption = yield* SubscriptionRef.get(supervisor.session);
          if (Option.isNone(sessionOption)) {
            return yield* Effect.die(new Error("Missing session after connected"));
          }
          const session = sessionOption.value;

          // Probe server
          yield* session.client[WS_METHODS.serverProbe]({});
          console.log("   Server probe answered successfully.");

          // Register a Project and Workspace via project.create
          console.log("7. Registering test Git directory as Project & Workspace...");
          const commandId = CommandId.make("cmd-smoke-1");
          const projectId = ProjectId.make("proj-smoke-1");
          yield* session.client[ORCHESTRATION_WS_METHODS.dispatchCommand]({
            type: "project.create",
            commandId,
            projectId,
            title: "Smoke Test Project",
            workspaceRoot: testRepoDir,
            defaultModelSelection: null,
            createdAt: new Date().toISOString(),
          });
          console.log("   Project & Workspace registered successfully.");
        }),
      ).pipe(Effect.provide(supervisorLayer)),
    );

    // 8. Confirm daemon is still running independently
    console.log("8. Verifying daemon survived client disconnection...");
    const postStatus = runCliJson(
      ["daemon", "status", "--base-dir", awenHome],
      REPOSITORY_ROOT,
      env,
    );
    if (!postStatus.ok || postStatus.status !== "ready" || postStatus.state.pid !== daemonPid) {
      throw new Error("Daemon was unexpectedly terminated after client disconnected.");
    }
    console.log("   Daemon is still healthy and running.");

    // 9. Stop daemon with confirmation
    console.log("9. Stopping daemon with confirmation...");
    const stopResult = runCliJson(
      ["daemon", "stop", "--confirm", "--base-dir", awenHome],
      REPOSITORY_ROOT,
      env,
    );
    console.log("   Stop result:", stopResult);
    if (!stopResult.ok || stopResult.status !== "stopped") {
      throw new Error(`Daemon stop failed: ${JSON.stringify(stopResult)}`);
    }

    // 10. Confirm status is absent
    const finalStatus = runCliJson(
      ["daemon", "status", "--base-dir", awenHome],
      REPOSITORY_ROOT,
      env,
    );
    console.log("   Final status:", finalStatus);
    if (finalStatus.status !== "absent") {
      throw new Error("Daemon is still reported running after stop.");
    }

    console.log("\n=== Headless Daemon Smoke Test PASSED! ===");
  } finally {
    // Cleanup scratch directory
    await NodeFSP.rm(scratchDir, { recursive: true, force: true }).catch(() => undefined);
  }
}

main().catch((error) => {
  console.error("Smoke test failed:", error);
  process.exit(1);
});
