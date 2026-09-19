#!/usr/bin/env node
// @effect-diagnostics nodeBuiltinImport:off globalTimers:off globalFetch:off globalConsole:off

import * as NodeChildProcess from "node:child_process";
import * as NodeFSP from "node:fs/promises";
import * as NodeNet from "node:net";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";

import {
  bootstrapRemoteBearerSession,
  fetchRemoteSessionState,
  issueRemoteWebSocketTicket,
} from "@t3tools/client-runtime/authorization";
import { fetchRemoteEnvironmentDescriptor } from "@t3tools/client-runtime/environment";
import {
  BearerConnectionProfile,
  BearerConnectionTarget,
  ConnectionDriver,
  ConnectionTransientError,
  Connectivity,
  EnvironmentSupervisor,
  makeEnvironmentSupervisor,
  type ConnectionCatalogEntry,
  type PreparedConnection,
  type SupervisorConnectionState,
  Wakeups,
} from "@t3tools/client-runtime/connection";
import {
  remoteHttpClientLayer,
  RpcSessionFactory,
  rpcSessionLayer,
} from "@t3tools/client-runtime/rpc";
import { AuthSessionState, AuthStandardClientScopes, WS_METHODS } from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import { HostProcessPlatform } from "@t3tools/shared/hostProcess";
import * as Layer from "effect/Layer";
import * as ManagedRuntime from "effect/ManagedRuntime";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";
import * as Socket from "effect/unstable/socket/Socket";
import * as Stream from "effect/Stream";
import * as SubscriptionRef from "effect/SubscriptionRef";

const REPOSITORY_ROOT = NodePath.resolve(import.meta.dirname, "..");
const SERVER_BINARY = NodePath.join(REPOSITORY_ROOT, "apps/server/dist/bin.mjs");
const READY_TIMEOUT_MS = 30_000;
const SHUTDOWN_TIMEOUT_MS = 10_000;
const decodeAuthSessionState = Schema.decodeUnknownSync(AuthSessionState);

export interface ServerReadyInfo {
  readonly connectionString: string;
  readonly token: string;
}

/** Extracts the stable access details printed by `t3 serve`. */
export function parseServerReadyOutput(output: string): ServerReadyInfo | undefined {
  const connectionString = /Connection string:\s+(\S+)/u.exec(output)?.[1];
  const token = /Token:\s+(\S+)/u.exec(output)?.[1];
  return connectionString && token ? { connectionString, token } : undefined;
}

interface ServerHandle {
  readonly child: NodeChildProcess.ChildProcess;
  readonly ready: Promise<ServerReadyInfo>;
}

function smokeEnvironment(): NodeJS.ProcessEnv {
  const environment = { ...process.env };
  // The smoke must never inherit a user's running T3 service or its data home.
  delete environment.T3CODE_HOME;
  delete environment.T3_SERVICE_LAUNCHER_CONTEXT;
  delete environment.T3_BOOT_SERVICE_UNIT;
  delete environment.T3CODE_DEV_AUTH_TOKEN;
  environment.T3CODE_AUTO_BOOTSTRAP_PROJECT_FROM_CWD = "0";
  environment.T3CODE_LOG_LEVEL = "Error";
  environment.T3CODE_NO_BROWSER = "1";
  return environment;
}

function startServer(baseDir: string, port: number): ServerHandle {
  let output = "";
  let readySettled = false;
  let resolveReady: (value: ServerReadyInfo) => void = () => undefined;
  let rejectReady: (reason: unknown) => void = () => undefined;
  const ready = new Promise<ServerReadyInfo>((resolve, reject) => {
    resolveReady = resolve;
    rejectReady = reject;
  });

  const child = NodeChildProcess.spawn(
    process.execPath,
    [SERVER_BINARY, "serve", "--base-dir", baseDir, "--port", String(port), "--host", "127.0.0.1"],
    {
      cwd: REPOSITORY_ROOT,
      env: smokeEnvironment(),
      stdio: ["ignore", "pipe", "pipe"],
    },
  );

  const appendOutput = (chunk: Buffer | string) => {
    output += chunk.toString();
    const parsed = parseServerReadyOutput(output);
    if (parsed && !readySettled) {
      readySettled = true;
      resolveReady(parsed);
    }
  };
  child.stdout?.on("data", appendOutput);
  child.stderr?.on("data", appendOutput);
  child.once("error", (error) => {
    if (!readySettled) {
      readySettled = true;
      rejectReady(error);
    }
  });
  child.once("exit", (code, signal) => {
    if (!readySettled) {
      readySettled = true;
      rejectReady(
        new Error(
          `Server exited before readiness (code=${String(code)}, signal=${String(signal)}).\n${output}`,
        ),
      );
    }
  });

  const timeout = setTimeout(() => {
    if (!readySettled) {
      readySettled = true;
      rejectReady(new Error(`Timed out waiting for server readiness.\n${output}`));
    }
  }, READY_TIMEOUT_MS);
  ready.finally(() => clearTimeout(timeout)).catch(() => undefined);

  return { child, ready };
}

async function stopServer(server: ServerHandle, platform: NodeJS.Platform): Promise<void> {
  if (server.child.exitCode !== null || server.child.signalCode !== null) return;

  await new Promise<void>((resolve) => {
    let settled = false;
    const finish = () => {
      if (settled) return;
      settled = true;
      clearTimeout(forceKillTimer);
      resolve();
    };
    const forceKillTimer = setTimeout(() => {
      if (platform === "win32") {
        server.child.kill();
      } else {
        server.child.kill("SIGKILL");
      }
    }, SHUTDOWN_TIMEOUT_MS);
    server.child.once("exit", finish);
    server.child.kill("SIGTERM");
  });
}

async function findFreePort(): Promise<number> {
  const listener = NodeNet.createServer();
  await new Promise<void>((resolve, reject) => {
    listener.once("error", reject);
    listener.listen(0, "127.0.0.1", () => resolve());
  });
  const address = listener.address();
  if (typeof address !== "object" || address === null) {
    listener.close();
    throw new Error("The smoke test could not determine an ephemeral port.");
  }
  const port = address.port;
  await new Promise<void>((resolve, reject) =>
    listener.close((error) => (error ? reject(error) : resolve())),
  );
  return port;
}

async function readAuthSessionState(url: string): Promise<AuthSessionState> {
  const response = await fetch(`${url}/api/auth/session`);
  const body = await response.text();
  if (!response.ok) {
    throw new Error(
      `Unauthenticated auth probe failed with HTTP ${String(response.status)}: ${body}`,
    );
  }
  return decodeAuthSessionState(JSON.parse(body));
}

function websocketBaseUrl(connectionString: string): string {
  const url = new URL(connectionString);
  url.protocol = "ws:";
  url.pathname = "/ws";
  return url.toString();
}

function waitForSupervisorState(
  supervisor: EnvironmentSupervisor["Service"],
  predicate: (phase: SupervisorConnectionState["phase"]) => boolean,
  description: string,
): Effect.Effect<SupervisorConnectionState, never, never> {
  return Effect.gen(function* () {
    for (let attempt = 0; attempt < READY_TIMEOUT_MS / 100; attempt += 1) {
      const state = yield* SubscriptionRef.get(supervisor.state);
      if (predicate(state.phase)) return state;
      yield* Effect.sleep("100 millis");
    }
    return yield* Effect.die(new Error(`Timed out waiting for supervisor state: ${description}.`));
  });
}

async function main(): Promise<void> {
  const platform = Effect.runSync(HostProcessPlatform);
  const serverBinaryExists = await NodeFSP.access(SERVER_BINARY)
    .then(() => true)
    .catch(() => false);
  if (!serverBinaryExists) {
    throw new Error(
      "apps/server/dist/bin.mjs is missing. Run `pnpm build` before the connection smoke.",
    );
  }

  const baseDir = await NodeFSP.mkdtemp(NodePath.join(NodeOS.tmpdir(), "acode-c01-connection-"));
  const port = await findFreePort();
  let firstServer: ServerHandle | undefined;
  let secondServer: ServerHandle | undefined;
  const httpRuntime = ManagedRuntime.make(remoteHttpClientLayer(globalThis.fetch));
  const sessionRuntime = ManagedRuntime.make(
    rpcSessionLayer({}).pipe(Layer.provide(Socket.layerWebSocketConstructorGlobal)),
  );

  try {
    firstServer = startServer(baseDir, port);
    const firstReady = await firstServer.ready;
    const httpBaseUrl = firstReady.connectionString;
    const wsBaseUrl = websocketBaseUrl(httpBaseUrl);

    const descriptor = await httpRuntime.runPromise(
      fetchRemoteEnvironmentDescriptor({ httpBaseUrl }),
    );
    const unauthenticated = await readAuthSessionState(httpBaseUrl);
    if (
      unauthenticated.authenticated !== false ||
      !unauthenticated.auth.bootstrapMethods.includes("one-time-token")
    ) {
      throw new Error("The daemon did not advertise its unauthenticated pairing state.");
    }

    const access = await httpRuntime.runPromise(
      bootstrapRemoteBearerSession({
        httpBaseUrl,
        credential: firstReady.token,
        scopes: AuthStandardClientScopes,
        clientMetadata: { label: "ACode C01 connection smoke", deviceType: "bot" },
      }),
    );
    const authenticated = await httpRuntime.runPromise(
      fetchRemoteSessionState({ httpBaseUrl, bearerToken: access.access_token }),
    );
    if (
      authenticated.authenticated !== true ||
      authenticated.sessionMethod !== "bearer-access-token"
    ) {
      throw new Error("The daemon did not return an authenticated bearer session.");
    }

    const target = new BearerConnectionTarget({
      environmentId: descriptor.environmentId,
      label: descriptor.label,
      connectionId: "acode-c01-smoke",
    });
    const profile = new BearerConnectionProfile({
      connectionId: target.connectionId,
      environmentId: target.environmentId,
      label: target.label,
      httpBaseUrl,
      wsBaseUrl,
    });
    const entry: ConnectionCatalogEntry = {
      target,
      profile: Option.some(profile),
      enabled: true,
    };

    const issueTicket = () =>
      httpRuntime.runPromise(
        issueRemoteWebSocketTicket({
          httpBaseUrl,
          bearerToken: access.access_token,
        }),
      );
    const driverLayer = Layer.effect(
      ConnectionDriver,
      Effect.gen(function* () {
        const sessions = yield* RpcSessionFactory;
        return ConnectionDriver.of({
          connect: (catalogEntry, reportProgress) =>
            Effect.gen(function* () {
              yield* reportProgress({ stage: "preparing" });
              const ticket = yield* Effect.tryPromise({
                try: issueTicket,
                catch: (cause) =>
                  new ConnectionTransientError({
                    reason: "transport",
                    detail: `Could not issue a websocket ticket: ${
                      cause instanceof Error ? cause.message : String(cause)
                    }`,
                  }),
              });
              const socketUrl = new URL(wsBaseUrl);
              socketUrl.searchParams.set("wsTicket", ticket.ticket);
              const prepared = {
                environmentId: catalogEntry.target.environmentId,
                label: catalogEntry.target.label,
                httpBaseUrl,
                socketUrl: socketUrl.toString(),
                httpAuthorization: { _tag: "Bearer", token: access.access_token },
                target: catalogEntry.target,
              } satisfies PreparedConnection;
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
    const result = await sessionRuntime.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const supervisor = yield* makeEnvironmentSupervisor(entry, { initiallyDesired: true });
          const connected = yield* waitForSupervisorState(
            supervisor,
            (phase) => phase === "connected",
            "initial connected",
          );
          const initialSession = yield* SubscriptionRef.get(supervisor.session).pipe(
            Effect.flatMap(
              Option.match({
                onNone: () =>
                  Effect.die(new Error("Supervisor reported connected without a session.")),
                onSome: Effect.succeed,
              }),
            ),
          );
          yield* initialSession.client[WS_METHODS.serverProbe]({});
          const refreshedProviders = yield* initialSession.client[
            WS_METHODS.serverRefreshProviders
          ]({});
          const invalidProvider = refreshedProviders.providers.find(
            (provider) => provider.auth.status === "authenticated" && !provider.installed,
          );
          if (invalidProvider !== undefined) {
            return yield* Effect.die(
              new Error(
                `Provider ${invalidProvider.instanceId} reported auth without installation.`,
              ),
            );
          }

          yield* Effect.promise(() => stopServer(firstServer!, platform));
          yield* waitForSupervisorState(
            supervisor,
            (phase) => phase === "backoff" || phase === "connecting" || phase === "offline",
            "disconnected after daemon stop",
          );

          secondServer = startServer(baseDir, port);
          yield* Effect.tryPromise({
            try: () => secondServer!.ready,
            catch: (cause) =>
              new ConnectionTransientError({
                reason: "transport",
                detail: `The restarted daemon did not become ready: ${
                  cause instanceof Error ? cause.message : String(cause)
                }`,
              }),
          });
          yield* supervisor.retryNow;
          const reconnected = yield* waitForSupervisorState(
            supervisor,
            (phase) => phase === "connected",
            "reconnected after daemon restart",
          );
          if (reconnected.generation <= connected.generation) {
            return yield* Effect.die(
              new Error("Supervisor reconnected without advancing its generation."),
            );
          }
          const reconnectedSession = yield* SubscriptionRef.get(supervisor.session).pipe(
            Effect.flatMap(
              Option.match({
                onNone: () =>
                  Effect.die(new Error("Reconnect reported connected without a session.")),
                onSome: Effect.succeed,
              }),
            ),
          );
          yield* reconnectedSession.client[WS_METHODS.serverProbe]({});

          return {
            providerSummary: refreshedProviders.providers.map(
              (provider) =>
                `${provider.instanceId}:${provider.auth.status}/${provider.installed ? "installed" : "missing"}`,
            ),
          };
        }),
      ).pipe(Effect.provide(supervisorLayer)),
    );

    console.log(`C01 connection smoke passed for ${descriptor.label}.`);
    console.log(`Provider catalog: ${result.providerSummary.join(", ") || "empty"}`);
    console.log(
      "Verified: unauthenticated pairing, bearer auth, typed probe, daemon disconnect, and automatic reconnect.",
    );
  } finally {
    if (secondServer !== undefined) await stopServer(secondServer, platform).catch(() => undefined);
    if (firstServer !== undefined) await stopServer(firstServer, platform).catch(() => undefined);
    await sessionRuntime.dispose();
    await httpRuntime.dispose();
    await NodeFSP.rm(baseDir, { recursive: true, force: true });
  }
}

if (import.meta.main) {
  main().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  });
}
