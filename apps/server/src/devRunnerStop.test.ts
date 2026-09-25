// @effect-diagnostics nodeBuiltinImport:off - Tests exercise the filesystem handshake boundary.
import * as NodeFS from "node:fs";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";

import * as NodeServices from "@effect/platform-node/NodeServices";
import { assert, it } from "@effect/vitest";
import * as Effect from "effect/Effect";

import {
  makeDevRunnerStopHandshake,
  withDevRunnerStopSignal,
  writeDevRunnerStopAck,
} from "./devRunnerStop.ts";

const makeScratch = Effect.acquireRelease(
  Effect.sync(() => NodeFS.mkdtempSync(NodePath.join(NodeOS.tmpdir(), "awen-server-stop-"))),
  (root) => Effect.sync(() => NodeFS.rmSync(root, { force: true, recursive: true })),
);

it.layer(NodeServices.layer)("dev-runner stop handshake", (it) => {
  it.effect("stays disabled without both environment paths", () =>
    Effect.sync(() => {
      assert.isUndefined(makeDevRunnerStopHandshake({}));
      assert.isUndefined(
        makeDevRunnerStopHandshake({
          AWEN_DEV_RUNNER_STOP_FILE: "/tmp/dev-runner.stop",
        }),
      );
      assert.isUndefined(
        makeDevRunnerStopHandshake({
          AWEN_DEV_RUNNER_STOP_ACK_FILE: "/tmp/dev-runner.stop.released",
        }),
      );
    }),
  );

  it.effect("marks the request when the stop file is already present", () =>
    Effect.gen(function* () {
      const root = yield* makeScratch;
      const stopFilePath = NodePath.join(root, "runner.stop");
      const handshake = makeDevRunnerStopHandshake({
        AWEN_DEV_RUNNER_STOP_FILE: stopFilePath,
        AWEN_DEV_RUNNER_STOP_ACK_FILE: `${stopFilePath}.released`,
      });
      assert.isDefined(handshake);
      NodeFS.writeFileSync(stopFilePath, "", "utf8");
      let interrupted = false;

      yield* Effect.scoped(
        withDevRunnerStopSignal(
          Effect.never.pipe(
            Effect.onInterrupt(() =>
              Effect.sync(() => {
                interrupted = true;
              }),
            ),
          ),
          handshake,
        ),
      );

      assert.isTrue(handshake.requested);
      assert.isTrue(interrupted);
    }).pipe(Effect.scoped),
  );

  it.effect("writes the acknowledgement after the scoped resource closes", () =>
    Effect.gen(function* () {
      const root = yield* makeScratch;
      const stopFilePath = NodePath.join(root, "runner.stop");
      const handshake = makeDevRunnerStopHandshake({
        AWEN_DEV_RUNNER_STOP_FILE: stopFilePath,
        AWEN_DEV_RUNNER_STOP_ACK_FILE: `${stopFilePath}.released`,
      });
      assert.isDefined(handshake);
      NodeFS.writeFileSync(stopFilePath, "", "utf8");
      const order: string[] = [];

      yield* Effect.scoped(
        withDevRunnerStopSignal(
          Effect.gen(function* () {
            yield* Effect.addFinalizer(() =>
              Effect.sync(() => {
                order.push("closed");
              }),
            );
            return yield* Effect.never;
          }),
          handshake,
        ),
      );
      writeDevRunnerStopAck(handshake);

      assert.deepStrictEqual(order, ["closed"]);
      assert.equal(NodeFS.readFileSync(handshake.ackFilePath, "utf8"), "released\n");
    }).pipe(Effect.scoped),
  );
});
