import { assert, describe, it } from "@effect/vitest";
import * as NodeServices from "@effect/platform-node/NodeServices";
import type { DesktopDiscoveredSshHost, DesktopSshEnvironmentTarget } from "@awen/contracts";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import { HttpClient, HttpClientResponse } from "effect/unstable/http";
import * as NetService from "@awen/shared/Net";

import * as SshPasswordPrompts from "./sshPasswordPrompts.ts";
import * as DesktopSshEnvironment from "./sshEnvironment.ts";
import * as SshTunnel from "@awen/ssh/tunnel";

const TARGET: DesktopSshEnvironmentTarget = {
  alias: "devbox",
  hostname: "devbox.example.test",
  username: "allen",
  port: 22,
};

describe("desktop SSH environment", () => {
  it.effect("delegates ensure and disconnect to the SSH tunnel manager", () => {
    const calls: string[] = [];
    const manager = SshTunnel.SshEnvironmentManager.of({
      inspectEnvironment: () =>
        Effect.succeed({
          version: "0.0.42",
          os: "Linux",
          arch: "x86_64",
          nodeVersion: "v22.16.0",
          nodeSupported: true,
          gitAvailable: true,
          daemon: "install" as const,
        }),
      ensureEnvironment: (target, options) => {
        calls.push(`ensure:${target.alias}:${options?.issuePairingToken === true}`);
        return Effect.succeed({
          target,
          httpBaseUrl: "http://127.0.0.1:4001/",
          wsBaseUrl: "ws://127.0.0.1:4001/",
          pairingToken: "pairing-token",
        });
      },
      disconnectEnvironment: (target) => {
        calls.push(`disconnect:${target.alias}`);
        return Effect.void;
      },
    });
    const prompts = SshPasswordPrompts.DesktopSshPasswordPrompts.of({
      listPending: Effect.succeed([]),
      request: () => Effect.succeed("secret"),
      resolve: () => Effect.void,
    });
    const runtimeServices = Layer.mergeAll(
      NodeServices.layer,
      Layer.succeed(
        HttpClient.HttpClient,
        HttpClient.make((request) =>
          Effect.succeed(HttpClientResponse.fromWeb(request, new Response("", { status: 200 }))),
        ),
      ),
      Layer.succeed(
        NetService.NetService,
        NetService.NetService.of({
          canListenOnHost: () => Effect.succeed(true),
          isPortAvailableOnLoopback: () => Effect.succeed(true),
          hasListenerOnHost: () => Effect.succeed(false),
          reserveLoopbackPort: () => Effect.succeed(41_773),
          findAvailablePort: (preferred) => Effect.succeed(preferred),
        }),
      ),
    );
    const layer = Layer.effect(
      DesktopSshEnvironment.DesktopSshEnvironment,
      DesktopSshEnvironment.make,
    ).pipe(
      Layer.provide(Layer.succeed(SshTunnel.SshEnvironmentManager, manager)),
      Layer.provide(Layer.succeed(SshPasswordPrompts.DesktopSshPasswordPrompts, prompts)),
      Layer.provide(runtimeServices),
    );

    return Effect.gen(function* () {
      const ssh = yield* DesktopSshEnvironment.DesktopSshEnvironment;
      const bootstrap = yield* ssh.ensureEnvironment(TARGET, { issuePairingToken: true });
      yield* ssh.disconnectEnvironment(TARGET);

      assert.equal(bootstrap.pairingToken, "pairing-token");
      assert.deepEqual(calls, ["ensure:devbox:true", "disconnect:devbox"]);
    }).pipe(Effect.provide(layer), Effect.scoped);
  });

  it.effect("classifies prompt cancellation from the daemon prompt service", () => {
    return Effect.gen(function* () {
      const cause = new SshPasswordPrompts.DesktopSshPromptCancelledError({
        requestId: "request-1",
        destination: "devbox",
      });
      const error = DesktopSshEnvironment.toSshPasswordPromptError(cause);
      assert.equal(DesktopSshEnvironment.isDesktopSshPasswordPromptCancellation(error), true);
    });
  });
});
