import { describe, expect, it } from "@effect/vitest";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as Fiber from "effect/Fiber";
import * as TestClock from "effect/testing/TestClock";

import { AuthBearerSessionRequest, EnvironmentAuthInvalidError } from "@awen/contracts";
import * as Schema from "effect/Schema";
import {
  appendClientConnectionParams,
  bootstrapRemoteBearerSession,
  fetchRemoteSessionState,
  issueRemoteWebSocketTicket,
  RemoteEnvironmentAuthTimeoutError,
  resolveRemoteWebSocketConnectionUrl,
} from "./remote.ts";
import { remoteHttpClientLayer } from "../rpc/http.ts";

const recordedFetch = (...responses: ReadonlyArray<Response>) => {
  const calls: Array<readonly [RequestInfo | URL, RequestInit]> = [];
  let responseIndex = 0;
  const fetchFn = ((input, init) => {
    calls.push([input, init ?? {}]);
    const response = responses[responseIndex++];
    if (!response) return Promise.reject(new Error("Unexpected fetch call"));
    return Promise.resolve(response);
  }) satisfies typeof fetch;
  return { fetchFn, calls };
};

const hangingFetch = () => {
  const calls: Array<readonly [RequestInfo | URL, RequestInit]> = [];
  const fetchFn = ((input, init) => {
    calls.push([input, init ?? {}]);
    return new Promise<Response>(() => undefined);
  }) satisfies typeof fetch;
  return { fetchFn, calls };
};

const provideRemoteHttp = (fetchFn: typeof fetch) => Effect.provide(remoteHttpClientLayer(fetchFn));
const isEnvironmentAuthInvalidError = Schema.is(EnvironmentAuthInvalidError);

describe("remote environment authorization", () => {
  it.effect("creates a bearer session from a pairing credential", () =>
    Effect.gen(function* () {
      const fetch = recordedFetch(
        Response.json({
          token: "bearer-token",
          scopes: ["orchestration:read"],
          expiresInSeconds: 3600,
        }),
      );
      const result = yield* bootstrapRemoteBearerSession({
        httpBaseUrl: "https://remote.example.com/",
        credential: "pairing-token",
        scopes: ["orchestration:read"],
        clientMetadata: { label: "Awen mobile client", deviceType: "mobile", os: "iOS" },
      }).pipe(provideRemoteHttp(fetch.fetchFn));

      expect(result).toEqual({
        token: "bearer-token",
        scopes: ["orchestration:read"],
        expiresInSeconds: 3600,
      });
      expect(String(fetch.calls[0]?.[0])).toBe(
        "https://remote.example.com/api/auth/bearer-session",
      );
      const body = fetch.calls[0]?.[1].body;
      const bodyText =
        body instanceof Uint8Array ? new TextDecoder().decode(body) : String(body ?? "");
      const decoded = yield* Schema.decodeUnknownEffect(
        Schema.fromJsonString(AuthBearerSessionRequest),
      )(bodyText);
      expect(decoded).toEqual({
        credential: "pairing-token",
        scopes: ["orchestration:read"],
        client: { label: "Awen mobile client", deviceType: "mobile", os: "iOS" },
      });
    }),
  );

  it.effect("reads session state and obtains a one-time websocket ticket with bearer auth", () =>
    Effect.gen(function* () {
      const fetch = recordedFetch(
        Response.json({
          authenticated: true,
          auth: {
            policy: "remote-reachable",
            bootstrapMethods: ["one-time-token"],
            sessionMethods: ["browser-session-cookie", "bearer-access-token"],
            sessionCookieName: "awen_session",
          },
          scopes: ["orchestration:read"],
          sessionMethod: "bearer-access-token",
          expiresAt: "2026-05-01T12:00:00.000Z",
        }),
        Response.json({ ticket: "ws-ticket", expiresAt: "2026-05-01T12:05:00.000Z" }),
      );
      const state = yield* fetchRemoteSessionState({
        httpBaseUrl: "https://remote.example.com/",
        bearerToken: "bearer-token",
      }).pipe(provideRemoteHttp(fetch.fetchFn));
      const ticket = yield* issueRemoteWebSocketTicket({
        httpBaseUrl: "https://remote.example.com/",
        bearerToken: "bearer-token",
      }).pipe(provideRemoteHttp(fetch.fetchFn));

      expect(state.authenticated).toBe(true);
      expect(ticket.ticket).toBe("ws-ticket");
      expect(fetch.calls.map(([url]) => String(url))).toEqual([
        "https://remote.example.com/api/auth/session",
        "https://remote.example.com/api/auth/websocket-ticket",
      ]);
      expect(fetch.calls[0]?.[1].headers).toMatchObject({ authorization: "Bearer bearer-token" });
      expect(fetch.calls[1]?.[1].headers).toMatchObject({ authorization: "Bearer bearer-token" });
    }),
  );

  it.effect("includes connection metadata in the websocket URL", () =>
    Effect.gen(function* () {
      const fetch = recordedFetch(
        Response.json({ ticket: "ws-ticket", expiresAt: "2026-05-01T12:05:00.000Z" }),
      );
      const url = yield* resolveRemoteWebSocketConnectionUrl({
        wsBaseUrl: "wss://remote.example.com/",
        httpBaseUrl: "https://remote.example.com/",
        bearerToken: "bearer-token",
        clientMetadata: {
          surface: "mobile",
          appVersion: "1.2.3",
          deviceType: "mobile",
          os: "Android",
          osMajorVersion: 15,
          deviceModel: "Pixel 9",
        },
        connectionMethod: "direct",
      }).pipe(provideRemoteHttp(fetch.fetchFn));

      expect(url).toBe(
        "wss://remote.example.com/ws?wsTicket=ws-ticket&clientSurface=mobile&clientAppVersion=1.2.3&clientDeviceType=phone&clientOs=Android&clientOsMajorVersion=15&clientDeviceModel=Pixel+9&connectionMethod=direct",
      );
      const urlWithoutUnknownOs = new URL("wss://remote.example.com/ws");
      appendClientConnectionParams(urlWithoutUnknownOs, { surface: "web", os: "unknown" });
      expect(urlWithoutUnknownOs.searchParams.has("clientOs")).toBe(true);
    }),
  );

  it.effect("revives declared authorization errors", () =>
    Effect.gen(function* () {
      const fetch = recordedFetch(
        Response.json(
          {
            _tag: "EnvironmentAuthInvalidError",
            code: "auth_invalid",
            reason: "missing_credential",
            traceId: "trace-auth-test",
          },
          { status: 401 },
        ),
      );
      const error = yield* issueRemoteWebSocketTicket({
        httpBaseUrl: "https://remote.example.com/",
        bearerToken: "expired-token",
      }).pipe(provideRemoteHttp(fetch.fetchFn), Effect.flip);

      expect(isEnvironmentAuthInvalidError(error)).toBe(true);
      if (isEnvironmentAuthInvalidError(error)) {
        expect(error.reason).toBe("missing_credential");
        expect(error.traceId).toBe("trace-auth-test");
      }
    }),
  );

  it.effect("fails hung requests on the configured timeout", () =>
    Effect.gen(function* () {
      const fetch = hangingFetch();
      const fiber = yield* bootstrapRemoteBearerSession({
        httpBaseUrl: "https://remote.example.com/",
        credential: "pairing-token",
        timeoutMs: 25,
      }).pipe(provideRemoteHttp(fetch.fetchFn), Effect.flip, Effect.forkScoped);
      yield* Effect.yieldNow;
      yield* TestClock.adjust(Duration.millis(25));
      const error = yield* Fiber.join(fiber);
      expect(error).toBeInstanceOf(RemoteEnvironmentAuthTimeoutError);
    }).pipe(Effect.provide(TestClock.layer())),
  );
});
