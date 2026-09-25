import {
  CommandId,
  EnvironmentId,
  ORCHESTRATION_WS_METHODS,
  ProjectId,
  ThreadId,
  type ClientOrchestrationCommand,
} from "@awen/contracts";
import { describe, expect, it } from "@effect/vitest";
import * as Crypto from "effect/Crypto";
import * as Deferred from "effect/Deferred";
import * as Effect from "effect/Effect";
import * as Fiber from "effect/Fiber";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as SubscriptionRef from "effect/SubscriptionRef";

import {
  AVAILABLE_CONNECTION_STATE,
  PrimaryConnectionTarget,
  type PreparedConnection,
} from "../connection/model.ts";
import * as EnvironmentSupervisor from "../connection/supervisor.ts";
import * as RpcSession from "../rpc/session.ts";
import type { WsRpcProtocolClient } from "../rpc/protocol.ts";
import {
  archiveThread,
  createProject,
  revertThreadCheckpoint,
  reorderActiveThread,
  settleThread,
  stopThreadSession,
  unsettleThread,
} from "./commands.ts";

const TEST_CRYPTO_LAYER = Layer.succeed(
  Crypto.Crypto,
  Crypto.make({
    randomBytes: (size) => new Uint8Array(size),
    digest: (_algorithm, data) => Effect.succeed(data),
  }),
);

const TARGET = new PrimaryConnectionTarget({
  environmentId: EnvironmentId.make("environment-1"),
  label: "Test environment",
  httpBaseUrl: "https://environment.example.test",
  wsBaseUrl: "wss://environment.example.test",
});

const makeSupervisor = Effect.fn("TestEnvironmentCommands.makeSupervisor")(function* (
  dispatched: ClientOrchestrationCommand[],
  dispatchCommand?: (
    command: ClientOrchestrationCommand,
  ) => Effect.Effect<{ readonly sequence: number }, never>,
) {
  const client = {
    [ORCHESTRATION_WS_METHODS.dispatchCommand]:
      dispatchCommand ??
      ((command: ClientOrchestrationCommand) =>
        Effect.sync(() => {
          dispatched.push(command);
          return { sequence: dispatched.length };
        })),
  } as unknown as WsRpcProtocolClient;
  const session: RpcSession.RpcSession = {
    client,
    initialConfig: Effect.never,
    subscribeServerConfig: (input) => client.subscribeServerConfig(input),
    ready: Effect.void,
    probe: Effect.void,
    closed: Effect.never,
  };
  return EnvironmentSupervisor.EnvironmentSupervisor.of({
    target: TARGET,
    state: yield* SubscriptionRef.make(AVAILABLE_CONNECTION_STATE),
    session: yield* SubscriptionRef.make(Option.some(session)),
    prepared: yield* SubscriptionRef.make(Option.none<PreparedConnection>()),
    connect: Effect.void,
    disconnect: Effect.void,
    retryNow: Effect.void,
  } satisfies EnvironmentSupervisor.EnvironmentSupervisor["Service"]);
});

describe("environment commands", () => {
  it.effect("adds generated command metadata", () =>
    Effect.gen(function* () {
      const dispatched: ClientOrchestrationCommand[] = [];
      const supervisor = yield* makeSupervisor(dispatched);

      const result = yield* createProject({
        projectId: ProjectId.make("project-1"),
        title: "Project",
        workspaceRoot: "/workspace/project",
        createdAt: "2026-06-06T00:00:00.000Z",
      }).pipe(Effect.provideService(EnvironmentSupervisor.EnvironmentSupervisor, supervisor));

      expect(result).toEqual({ sequence: 1 });
      expect(dispatched).toEqual([
        {
          type: "project.create",
          commandId: "00000000-0000-4000-8000-000000000000",
          projectId: "project-1",
          title: "Project",
          workspaceRoot: "/workspace/project",
          createdAt: "2026-06-06T00:00:00.000Z",
        },
      ]);
    }).pipe(Effect.provide(TEST_CRYPTO_LAYER)),
  );

  it.effect("retains one command id for retries of the same operation identity", () =>
    Effect.gen(function* () {
      const dispatched: ClientOrchestrationCommand[] = [];
      const firstDispatched = yield* Deferred.make<void>();
      const release = yield* Deferred.make<void>();
      const supervisor = yield* makeSupervisor(dispatched, (command) =>
        Effect.gen(function* () {
          dispatched.push(command);
          if (dispatched.length === 1) {
            yield* Deferred.succeed(firstDispatched, undefined);
          }
          yield* Deferred.await(release);
          return { sequence: 1 };
        }),
      );
      const input = {
        operationId: "project-create-retained",
        projectId: ProjectId.make("project-retained"),
        title: "Retained project",
        workspaceRoot: "/workspace/retained",
        createdAt: "2026-06-06T00:00:00.000Z",
      } as const;

      const first = yield* createProject(input).pipe(
        Effect.provideService(EnvironmentSupervisor.EnvironmentSupervisor, supervisor),
        Effect.forkChild,
      );
      yield* Deferred.await(firstDispatched);
      const second = yield* createProject(input).pipe(
        Effect.provideService(EnvironmentSupervisor.EnvironmentSupervisor, supervisor),
        Effect.forkChild,
      );
      while (dispatched.length < 2) {
        yield* Effect.yieldNow;
      }
      yield* Deferred.succeed(release, undefined);
      yield* Fiber.join(first);
      yield* Fiber.join(second);

      expect(dispatched).toHaveLength(2);
      expect(dispatched[1]?.commandId).toBe(dispatched[0]?.commandId);
      expect("operationId" in (dispatched[0] ?? {})).toBe(false);
    }).pipe(Effect.provide(TEST_CRYPTO_LAYER)),
  );

  it.effect("uses a distinct command when keeping workspace changes", () =>
    Effect.gen(function* () {
      const dispatched: ClientOrchestrationCommand[] = [];
      const supervisor = yield* makeSupervisor(dispatched);
      for (const restoreFiles of [undefined, true, false]) {
        yield* revertThreadCheckpoint({
          commandId: CommandId.make("rewind-command"),
          threadId: ThreadId.make("thread-1"),
          turnCount: 0,
          ...(restoreFiles !== undefined ? { restoreFiles } : {}),
          createdAt: "2026-06-06T00:01:00.000Z",
        }).pipe(Effect.provideService(EnvironmentSupervisor.EnvironmentSupervisor, supervisor));
      }
      expect(dispatched.map((command) => command.type)).toEqual([
        "thread.checkpoint.revert",
        "thread.checkpoint.revert",
        "thread.conversation.revert",
      ]);
    }).pipe(Effect.provide(TEST_CRYPTO_LAYER)),
  );

  it.effect("preserves caller metadata for idempotent queued commands", () =>
    Effect.gen(function* () {
      const dispatched: ClientOrchestrationCommand[] = [];
      const supervisor = yield* makeSupervisor(dispatched);

      yield* stopThreadSession({
        commandId: CommandId.make("queued-command"),
        threadId: ThreadId.make("thread-1"),
        createdAt: "2026-06-06T00:01:00.000Z",
      }).pipe(Effect.provideService(EnvironmentSupervisor.EnvironmentSupervisor, supervisor));

      expect(dispatched).toEqual([
        {
          type: "thread.session.stop",
          commandId: "queued-command",
          threadId: "thread-1",
          createdAt: "2026-06-06T00:01:00.000Z",
        },
      ]);
    }).pipe(Effect.provide(TEST_CRYPTO_LAYER)),
  );

  it.effect("does not add timestamps to commands without createdAt", () =>
    Effect.gen(function* () {
      const dispatched: ClientOrchestrationCommand[] = [];
      const supervisor = yield* makeSupervisor(dispatched);

      yield* archiveThread({
        commandId: CommandId.make("archive-command"),
        threadId: ThreadId.make("thread-1"),
      }).pipe(Effect.provideService(EnvironmentSupervisor.EnvironmentSupervisor, supervisor));

      expect(dispatched).toEqual([
        {
          type: "thread.archive",
          commandId: "archive-command",
          threadId: "thread-1",
        },
      ]);
    }).pipe(Effect.provide(TEST_CRYPTO_LAYER)),
  );

  it.effect("dispatches settle and unsettle commands without timestamps", () =>
    Effect.gen(function* () {
      const dispatched: ClientOrchestrationCommand[] = [];
      const supervisor = yield* makeSupervisor(dispatched);

      yield* settleThread({
        commandId: CommandId.make("settle-command"),
        threadId: ThreadId.make("thread-1"),
      }).pipe(Effect.provideService(EnvironmentSupervisor.EnvironmentSupervisor, supervisor));
      yield* unsettleThread({
        commandId: CommandId.make("unsettle-command"),
        threadId: ThreadId.make("thread-1"),
        reason: "user",
      }).pipe(Effect.provideService(EnvironmentSupervisor.EnvironmentSupervisor, supervisor));

      expect(dispatched).toEqual([
        {
          type: "thread.settle",
          commandId: "settle-command",
          threadId: "thread-1",
        },
        {
          type: "thread.unsettle",
          commandId: "unsettle-command",
          threadId: "thread-1",
          reason: "user",
        },
      ]);
    }).pipe(Effect.provide(TEST_CRYPTO_LAYER)),
  );

  it.effect("sends an active order key without changing activity timestamps", () =>
    Effect.gen(function* () {
      const dispatched: ClientOrchestrationCommand[] = [];
      const supervisor = yield* makeSupervisor(dispatched);
      yield* reorderActiveThread({
        commandId: CommandId.make("reorder-command"),
        threadId: ThreadId.make("thread-1"),
        orderKey: "mf",
      }).pipe(Effect.provideService(EnvironmentSupervisor.EnvironmentSupervisor, supervisor));
      expect(dispatched).toEqual([
        {
          type: "thread.active.reorder",
          commandId: "reorder-command",
          threadId: "thread-1",
          orderKey: "mf",
        },
      ]);
    }).pipe(Effect.provide(TEST_CRYPTO_LAYER)),
  );
});
