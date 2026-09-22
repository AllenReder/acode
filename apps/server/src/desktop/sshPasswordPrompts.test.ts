import { describe, expect, it } from "@effect/vitest";
import * as NodeServices from "@effect/platform-node/NodeServices";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as Fiber from "effect/Fiber";
import * as Layer from "effect/Layer";
import * as TestClock from "effect/testing/TestClock";

import * as SshPasswordPrompts from "./sshPasswordPrompts.ts";

const testLayer = SshPasswordPrompts.layer({ passwordPromptTimeoutMs: 1_000 }).pipe(
  Layer.provide(NodeServices.layer),
  Layer.provideMerge(TestClock.layer()),
);

describe("desktop SSH password prompts", () => {
  it.effect("publishes a pending prompt and resolves its password", () =>
    Effect.gen(function* () {
      const prompts = yield* SshPasswordPrompts.DesktopSshPasswordPrompts;
      const fiber = yield* prompts
        .request({
          destination: "devbox",
          username: "allen",
          prompt: "Enter the SSH password.",
          attempt: 1,
        })
        .pipe(Effect.forkScoped);

      yield* Effect.yieldNow;
      const pending = yield* prompts.listPending;
      expect(pending).toHaveLength(1);
      expect(pending[0]?.destination).toBe("devbox");
      expect(pending[0]?.username).toBe("allen");

      yield* prompts.resolve({
        requestId: pending[0]!.requestId,
        password: "secret",
      });
      expect(yield* Fiber.join(fiber)).toBe("secret");
      expect(yield* prompts.listPending).toEqual([]);
    }).pipe(Effect.provide(testLayer), Effect.scoped),
  );

  it.effect("cancels a pending prompt without exposing it again", () =>
    Effect.gen(function* () {
      const prompts = yield* SshPasswordPrompts.DesktopSshPasswordPrompts;
      const fiber = yield* prompts
        .request({
          destination: "devbox",
          username: null,
          prompt: "Enter the SSH password.",
          attempt: 1,
        })
        .pipe(Effect.forkScoped);

      yield* Effect.yieldNow;
      const pending = yield* prompts.listPending;
      yield* prompts.resolve({ requestId: pending[0]!.requestId, password: null });

      const error = yield* Fiber.join(fiber).pipe(Effect.flip);
      expect(error).toBeInstanceOf(SshPasswordPrompts.DesktopSshPromptCancelledError);
      expect(yield* prompts.listPending).toEqual([]);
    }).pipe(Effect.provide(testLayer), Effect.scoped),
  );

  it.effect("times out and removes a pending prompt", () =>
    Effect.gen(function* () {
      const prompts = yield* SshPasswordPrompts.DesktopSshPasswordPrompts;
      const fiber = yield* prompts
        .request({
          destination: "devbox",
          username: null,
          prompt: "Enter the SSH password.",
          attempt: 1,
        })
        .pipe(Effect.forkScoped);

      yield* Effect.yieldNow;
      yield* TestClock.adjust(Duration.millis(1_000));
      const error = yield* Fiber.join(fiber).pipe(Effect.flip);

      expect(error).toBeInstanceOf(SshPasswordPrompts.DesktopSshPromptTimedOutError);
      expect(yield* prompts.listPending).toEqual([]);
    }).pipe(Effect.provide(testLayer), Effect.scoped),
  );
});
