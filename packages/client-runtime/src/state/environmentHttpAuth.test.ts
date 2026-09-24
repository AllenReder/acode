import { describe, expect, it } from "@effect/vitest";
import { EnvironmentId } from "@awen/contracts";
import * as Effect from "effect/Effect";

import { PrimaryConnectionTarget } from "../connection/model.ts";
import { remoteHttpClientLayer } from "../rpc/http.ts";
import { executeAuthenticatedEnvironmentHttpRequest } from "./environmentHttpAuth.ts";

const target = new PrimaryConnectionTarget({
  environmentId: EnvironmentId.make("environment-test"),
  label: "Test environment",
  httpBaseUrl: "https://environment.example.test",
  wsBaseUrl: "wss://environment.example.test",
});

const sessionState = {
  authenticated: false,
  auth: {
    policy: "remote-reachable",
    bootstrapMethods: ["one-time-token"],
    sessionMethods: ["browser-session-cookie", "bearer-access-token"],
    sessionCookieName: "awen_session",
  },
};

describe("authenticated environment HTTP", () => {
  it.effect("uses cookies for the primary environment", () =>
    Effect.gen(function* () {
      let requestInit: RequestInit | undefined;
      const fetch = ((_, init) => {
        requestInit = init;
        return Promise.resolve(Response.json(sessionState));
      }) satisfies typeof globalThis.fetch;
      const result = yield* executeAuthenticatedEnvironmentHttpRequest({
        prepared: {
          environmentId: target.environmentId,
          label: target.label,
          httpBaseUrl: target.httpBaseUrl,
          socketUrl: `${target.wsBaseUrl}/ws`,
          httpAuthorization: null,
          target,
        },
        method: "GET",
        url: (baseUrl) => `${baseUrl}/api/auth/session`,
        timeoutMs: 1_000,
        group: "auth",
        request: ({ client, headers }) => client.session({ headers }),
      }).pipe(Effect.provide(remoteHttpClientLayer(fetch)));

      expect(result.authenticated).toBe(false);
      expect(requestInit?.credentials).toBe("include");
      expect(new Headers(requestInit?.headers).get("authorization")).toBeNull();
    }),
  );

  it.effect("sends the stored bearer credential for a paired environment", () =>
    Effect.gen(function* () {
      let requestInit: RequestInit | undefined;
      const fetch = ((_, init) => {
        requestInit = init;
        return Promise.resolve(Response.json(sessionState));
      }) satisfies typeof globalThis.fetch;
      const result = yield* executeAuthenticatedEnvironmentHttpRequest({
        prepared: {
          environmentId: target.environmentId,
          label: target.label,
          httpBaseUrl: target.httpBaseUrl,
          socketUrl: `${target.wsBaseUrl}/ws`,
          httpAuthorization: { _tag: "Bearer", token: "paired-token" },
          target,
        },
        method: "GET",
        url: (baseUrl) => `${baseUrl}/api/auth/session`,
        timeoutMs: 1_000,
        group: "auth",
        request: ({ client, headers }) => client.session({ headers }),
      }).pipe(Effect.provide(remoteHttpClientLayer(fetch)));

      expect(result.authenticated).toBe(false);
      expect(new Headers(requestInit?.headers).get("authorization")).toBe("Bearer paired-token");
      expect(requestInit?.credentials).toBeUndefined();
    }),
  );
});
