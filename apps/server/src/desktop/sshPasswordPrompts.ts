import type { DesktopSshPasswordPromptRequest } from "@t3tools/contracts";
import { DesktopSshPasswordPromptResolutionInputSchema } from "@t3tools/contracts";
import type { SshPasswordRequest } from "@t3tools/ssh/auth";
import * as Context from "effect/Context";
import * as Crypto from "effect/Crypto";
import * as DateTime from "effect/DateTime";
import * as Deferred from "effect/Deferred";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Ref from "effect/Ref";
import * as Schema from "effect/Schema";

const DEFAULT_SSH_PASSWORD_PROMPT_TIMEOUT_MS = 3 * 60 * 1000;

type DesktopSshPasswordPromptResolutionInput =
  typeof DesktopSshPasswordPromptResolutionInputSchema.Type;

export class DesktopSshPromptRequestIdGenerationError extends Schema.TaggedError<DesktopSshPromptRequestIdGenerationError>()(
  "DesktopSshPromptRequestIdGenerationError",
  {
    destination: Schema.String,
    cause: Schema.Defect(),
  },
) {
  override get message(): string {
    return "Secure randomness is unavailable.";
  }
}

export class DesktopSshPromptTimedOutError extends Schema.TaggedError<DesktopSshPromptTimedOutError>()(
  "DesktopSshPromptTimedOutError",
  {
    requestId: Schema.String,
    destination: Schema.String,
  },
) {
  override get message(): string {
    return `SSH authentication timed out for ${this.destination}.`;
  }
}

export class DesktopSshPromptCancelledError extends Schema.TaggedError<DesktopSshPromptCancelledError>()(
  "DesktopSshPromptCancelledError",
  {
    requestId: Schema.String,
    destination: Schema.String,
  },
) {
  override get message(): string {
    return `SSH authentication cancelled for ${this.destination}.`;
  }
}

export class DesktopSshPromptServiceStoppedError extends Schema.TaggedError<DesktopSshPromptServiceStoppedError>()(
  "DesktopSshPromptServiceStoppedError",
  {
    requestId: Schema.String,
    destination: Schema.String,
  },
) {
  override get message(): string {
    return "SSH password prompt service stopped.";
  }
}

export class DesktopSshPromptInvalidRequestIdError extends Schema.TaggedError<DesktopSshPromptInvalidRequestIdError>()(
  "DesktopSshPromptInvalidRequestIdError",
  {
    requestId: Schema.String,
  },
) {
  override get message(): string {
    return "Invalid SSH password prompt id.";
  }
}

export class DesktopSshPromptExpiredError extends Schema.TaggedError<DesktopSshPromptExpiredError>()(
  "DesktopSshPromptExpiredError",
  {
    requestId: Schema.String,
  },
) {
  override get message(): string {
    return "SSH password prompt expired. Try connecting again.";
  }
}

export type DesktopSshPasswordPromptRequestError =
  | DesktopSshPromptRequestIdGenerationError
  | DesktopSshPromptTimedOutError
  | DesktopSshPromptCancelledError
  | DesktopSshPromptServiceStoppedError;

export type DesktopSshPasswordPromptResolveError =
  | DesktopSshPromptInvalidRequestIdError
  | DesktopSshPromptExpiredError;

export const DesktopSshPasswordPromptCancellation = Schema.Union([
  DesktopSshPromptCancelledError,
  DesktopSshPromptServiceStoppedError,
  DesktopSshPromptTimedOutError,
]);
export type DesktopSshPasswordPromptCancellation = typeof DesktopSshPasswordPromptCancellation.Type;

export const isDesktopSshPasswordPromptCancellation = Schema.is(
  DesktopSshPasswordPromptCancellation,
);

export class DesktopSshPasswordPrompts extends Context.Service<
  DesktopSshPasswordPrompts,
  {
    readonly listPending: Effect.Effect<readonly DesktopSshPasswordPromptRequest[]>;
    readonly request: (
      request: SshPasswordRequest,
    ) => Effect.Effect<string, DesktopSshPasswordPromptRequestError>;
    readonly resolve: (
      input: DesktopSshPasswordPromptResolutionInput,
    ) => Effect.Effect<void, DesktopSshPasswordPromptResolveError>;
  }
>()("t3/desktop/sshPasswordPrompts/DesktopSshPasswordPrompts") {}

interface PendingSshPasswordPrompt {
  readonly request: DesktopSshPasswordPromptRequest;
  readonly deferred: Deferred.Deferred<string, DesktopSshPasswordPromptRequestError>;
}

export interface DesktopSshPasswordPromptsOptions {
  readonly passwordPromptTimeoutMs?: number;
}

const removePending = (
  pendingRef: Ref.Ref<Map<string, PendingSshPasswordPrompt>>,
  requestId: string,
) =>
  Ref.modify(pendingRef, (pending) => {
    const entry = pending.get(requestId);
    if (entry === undefined) {
      return [Option.none<PendingSshPasswordPrompt>(), pending] as const;
    }
    const nextPending = new Map(pending);
    nextPending.delete(requestId);
    return [Option.some(entry), nextPending] as const;
  });

const failPending = (
  pending: PendingSshPasswordPrompt,
  error: DesktopSshPasswordPromptRequestError,
) => Deferred.fail(pending.deferred, error).pipe(Effect.asVoid);

export const make = Effect.fn("desktop.sshPasswordPrompts.make")(function* (
  options: DesktopSshPasswordPromptsOptions = {},
) {
  const crypto = yield* Crypto.Crypto;
  const pendingRef = yield* Ref.make(new Map<string, PendingSshPasswordPrompt>());
  const passwordPromptTimeoutMs =
    options.passwordPromptTimeoutMs ?? DEFAULT_SSH_PASSWORD_PROMPT_TIMEOUT_MS;

  const cancelPending = () =>
    Ref.getAndSet(pendingRef, new Map()).pipe(
      Effect.flatMap((pending) =>
        Effect.forEach(
          pending.values(),
          (entry) =>
            failPending(
              entry,
              new DesktopSshPromptServiceStoppedError({
                requestId: entry.request.requestId,
                destination: entry.request.destination,
              }),
            ),
          { discard: true },
        ),
      ),
      Effect.asVoid,
    );

  yield* Effect.addFinalizer(() => cancelPending().pipe(Effect.ignore));

  const listPending = Ref.get(pendingRef).pipe(
    Effect.map((pending) => [...pending.values()].map((entry) => entry.request)),
  );

  const resolve: DesktopSshPasswordPrompts["Service"]["resolve"] = Effect.fn(
    "desktop.sshPasswordPrompts.resolve",
  )(function* (input) {
    const requestId = input.requestId.trim();
    if (requestId.length === 0) {
      return yield* new DesktopSshPromptInvalidRequestIdError({ requestId: input.requestId });
    }

    const pending = yield* removePending(pendingRef, requestId);
    if (Option.isNone(pending)) {
      return yield* new DesktopSshPromptExpiredError({ requestId });
    }

    if (input.password === null) {
      yield* failPending(
        pending.value,
        new DesktopSshPromptCancelledError({
          requestId,
          destination: pending.value.request.destination,
        }),
      );
      return;
    }

    yield* Deferred.succeed(pending.value.deferred, input.password).pipe(Effect.asVoid);
  });

  const request: DesktopSshPasswordPrompts["Service"]["request"] = Effect.fn(
    "desktop.sshPasswordPrompts.request",
  )(function* (input) {
    const requestId = yield* crypto.randomUUIDv4.pipe(
      Effect.mapError(
        (cause) =>
          new DesktopSshPromptRequestIdGenerationError({
            destination: input.destination,
            cause,
          }),
      ),
    );
    const now = yield* DateTime.now;
    const request: DesktopSshPasswordPromptRequest = {
      requestId,
      destination: input.destination,
      username: input.username,
      prompt: input.prompt,
      expiresAt: DateTime.formatIso(
        DateTime.add(now, { milliseconds: passwordPromptTimeoutMs }),
      ),
    };
    const deferred = yield* Deferred.make<string, DesktopSshPasswordPromptRequestError>();
    yield* Ref.update(pendingRef, (pending) =>
      new Map(pending).set(requestId, { request, deferred }),
    );

    return yield* Deferred.await(deferred).pipe(
      Effect.timeoutOption(Duration.millis(passwordPromptTimeoutMs)),
      Effect.flatMap(
        Option.match({
          onSome: Effect.succeed,
          onNone: () =>
            removePending(pendingRef, requestId).pipe(
              Effect.andThen(
                Effect.fail(
                  new DesktopSshPromptTimedOutError({
                    requestId,
                    destination: input.destination,
                  }),
                ),
              ),
            ),
        }),
      ),
      Effect.ensuring(removePending(pendingRef, requestId).pipe(Effect.ignore)),
    );
  });

  return DesktopSshPasswordPrompts.of({
    listPending,
    request,
    resolve,
  });
});

export const layer = (options: DesktopSshPasswordPromptsOptions = {}) =>
  Layer.effect(DesktopSshPasswordPrompts, make(options));
