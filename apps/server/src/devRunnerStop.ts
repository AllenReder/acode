// @effect-diagnostics nodeBuiltinImport:off - The synchronous process teardown writes the handshake acknowledgement.
import * as NodeFS from "node:fs";
import * as NodePath from "node:path";

import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";

export const DEV_RUNNER_STOP_FILE_ENV = "AWEN_DEV_RUNNER_STOP_FILE";
export const DEV_RUNNER_STOP_ACK_FILE_ENV = "AWEN_DEV_RUNNER_STOP_ACK_FILE";

export interface DevRunnerStopHandshake {
  readonly stopFilePath: string;
  readonly ackFilePath: string;
  /** Set by the watcher before the main scope is interrupted. */
  requested: boolean;
}

/**
 * Resolve the development-only shutdown handshake.
 *
 * Both variables are set by `scripts/dev-runner.ts` on Windows. Absence of
 * either one keeps the regular server command unchanged.
 */
export function makeDevRunnerStopHandshake(
  environment: Readonly<Record<string, string | undefined>>,
): DevRunnerStopHandshake | undefined {
  const stopFilePath = environment[DEV_RUNNER_STOP_FILE_ENV]?.trim();
  const ackFilePath = environment[DEV_RUNNER_STOP_ACK_FILE_ENV]?.trim();
  if (!stopFilePath || !ackFilePath) return undefined;
  return { ackFilePath, requested: false, stopFilePath };
}

function waitForFile(path: string) {
  return Effect.gen(function* () {
    const fileSystem = yield* FileSystem.FileSystem;
    for (;;) {
      if (yield* fileSystem.exists(path)) return;
      yield* Effect.sleep("100 millis");
    }
  });
}

/**
 * Interrupt the server when the dev-runner requests shutdown.
 *
 * The stop file is deliberately not removed here. The runner keeps it in
 * place until the server acknowledges, so both processes observe the same
 * request even when their polling intervals interleave.
 */
export function withDevRunnerStopSignal<A, E, R>(
  program: Effect.Effect<A, E, R>,
  handshake: DevRunnerStopHandshake,
) {
  return Effect.raceFirst(
    program,
    waitForFile(handshake.stopFilePath).pipe(
      Effect.tap(() =>
        Effect.sync(() => {
          handshake.requested = true;
        }),
      ),
    ),
  );
}

/**
 * Write the acknowledgement after the Effect scope has drained.
 *
 * This runs from the Node runtime teardown, after SQLite and other scope
 * finalizers complete. The write is synchronous because the process may exit
 * immediately afterwards; failures are ignored so shutdown cannot be blocked
 * by an unobservable ack file.
 */
export function writeDevRunnerStopAck(handshake: DevRunnerStopHandshake): void {
  if (!handshake.requested) return;
  try {
    NodeFS.mkdirSync(NodePath.dirname(handshake.ackFilePath), { recursive: true });
    NodeFS.writeFileSync(handshake.ackFilePath, "released\n", {
      encoding: "utf8",
      mode: 0o600,
    });
  } catch {
    // The runner has a force-cleanup timeout; a failed ack must not block exit.
  }
}
