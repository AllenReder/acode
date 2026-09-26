// @effect-diagnostics unsafeEffectTypeAssertion:off
import {
  AuthOrchestrationOperateScope,
  AuthOrchestrationReadScope,
  AuthSessionId,
  AuthStandardClientScopes,
  AuthTerminalOperateScope,
  EnvironmentAuthInvalidError,
  EnvironmentOperationForbiddenError,
  EnvironmentRequestInvalidError,
  EnvironmentResourceNotFoundError,
  EnvironmentScopeRequiredError,
} from "@awen/contracts";
import {
  SshCommandError,
  SshHostDiscoveryError,
  SshHttpBridgeError,
  SshPasswordPromptError,
} from "@awen/ssh/errors";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Schema from "effect/Schema";
import {
  HttpClient,
  HttpClientRequest,
  HttpClientResponse,
  HttpRouter,
} from "effect/unstable/http";
import { describe, expect, it } from "vite-plus/test";

import * as EnvironmentAuth from "../auth/EnvironmentAuth.ts";
import {
  desktopSshBootstrapBearerRouteLayer,
  DesktopSshEnvironmentRequestError,
  remoteRequestFailureCode,
  sshErrorStatus,
  sshRequestErrorStatus,
} from "./sshRoutes.ts";

const encodeJson = Schema.encodeSync(Schema.fromJsonString(Schema.Unknown));

describe("remoteRequestFailureCode", () => {
  it("classifies declared daemon authentication failures", () => {
    expect(
      remoteRequestFailureCode(
        "bootstrap-bearer-session",
        new EnvironmentAuthInvalidError({
          code: "auth_invalid",
          reason: "invalid_credential",
          traceId: "trace-auth",
        }),
        null,
      ),
    ).toBe("daemon-authentication");
    expect(
      remoteRequestFailureCode(
        "fetch-session-state",
        new EnvironmentScopeRequiredError({
          code: "insufficient_scope",
          requiredScope: AuthOrchestrationReadScope,
          traceId: "trace-scope",
        }),
        null,
      ),
    ).toBe("daemon-authentication");
    expect(
      remoteRequestFailureCode(
        "fetch-session-state",
        new EnvironmentOperationForbiddenError({
          code: "operation_forbidden",
          reason: "current_session_revoke_not_allowed",
          traceId: "trace-forbidden",
        }),
        null,
      ),
    ).toBe("daemon-authentication");
  });

  it("classifies descriptor incompatibility as a protocol mismatch", () => {
    expect(
      remoteRequestFailureCode(
        "fetch-environment-descriptor",
        new EnvironmentResourceNotFoundError({
          code: "not_found",
          reason: "thread_not_found",
          traceId: "trace-not-found",
        }),
        null,
      ),
    ).toBe("protocol-mismatch");
    expect(
      remoteRequestFailureCode(
        "fetch-environment-descriptor",
        new EnvironmentRequestInvalidError({
          code: "invalid_request",
          reason: "invalid_command",
          traceId: "trace-invalid",
        }),
        null,
      ),
    ).toBe("protocol-mismatch");
  });

  it("keeps transport failures in the daemon-start category", () => {
    expect(
      remoteRequestFailureCode(
        "fetch-session-state",
        new SshHttpBridgeError({ message: "socket closed" }),
        null,
      ),
    ).toBe("daemon-start");
  });
});

describe("sshRequestErrorStatus", () => {
  it("maps authentication and protocol failures to actionable HTTP statuses", () => {
    expect(
      sshRequestErrorStatus(
        new DesktopSshEnvironmentRequestError({
          operation: "bootstrap-bearer-session",
          cause: new SshHttpBridgeError({ message: "invalid credential" }),
          sshHttpStatus: null,
          failureCode: "daemon-authentication",
        }),
      ),
    ).toBe(401);
    expect(
      sshRequestErrorStatus(
        new DesktopSshEnvironmentRequestError({
          operation: "fetch-environment-descriptor",
          cause: new SshHttpBridgeError({ message: "missing descriptor" }),
          sshHttpStatus: null,
          failureCode: "protocol-mismatch",
        }),
      ),
    ).toBe(409);
    expect(
      sshRequestErrorStatus(
        new DesktopSshEnvironmentRequestError({
          operation: "fetch-session-state",
          cause: new SshHttpBridgeError({ message: "socket closed" }),
          sshHttpStatus: null,
          failureCode: "daemon-start",
        }),
      ),
    ).toBe(502);
  });
});

describe("sshErrorStatus", () => {
  it("maps structured SSH failures to HTTP statuses without parsing messages", () => {
    expect(
      sshErrorStatus(
        new SshHostDiscoveryError({
          message: "SSH host key changed for devbox.",
          cause: null,
        }),
      ),
    ).toBe(409);
    expect(
      sshErrorStatus(new SshPasswordPromptError({ message: "SSH authentication cancelled." })),
    ).toBe(401);
    expect(
      sshErrorStatus(
        new SshCommandError({
          message: "AWEN_ERROR prerequisite-missing Remote host is missing Git on PATH.",
          command: ["ssh", "devbox"],
          exitCode: 1,
          stderr: "AWEN_ERROR prerequisite-missing Remote host is missing Git on PATH.",
        }),
      ),
    ).toBe(422);
  });
});

describe("desktopSshBootstrapBearerRouteLayer", () => {
  it("requests bearer session with AuthStandardClientScopes including terminal:operate", async () => {
    let capturedRequest: HttpClientRequest.HttpClientRequest | undefined;
    let capturedPayload: unknown = null;

    const mockHttpClient = HttpClient.make((request) =>
      Effect.gen(function* () {
        capturedRequest = request;
        const webRequest = yield* Effect.orDie(HttpClientRequest.toWeb(request));
        capturedPayload = yield* Effect.promise(() => webRequest.json());
        const responseBody = encodeJson({
          token: "mock-remote-bearer-token",
          scopes:
            capturedPayload && typeof capturedPayload === "object" && "scopes" in capturedPayload
              ? (capturedPayload as { scopes: unknown }).scopes
              : [],
          expiresInSeconds: 3600,
        });
        return HttpClientResponse.fromWeb(
          request,
          new Response(responseBody, {
            status: 200,
            headers: { "content-type": "application/json" },
          }),
        );
      }),
    );

    const authLayer = Layer.succeed(EnvironmentAuth.EnvironmentAuth, {
      authenticateHttpRequest: () =>
        Effect.succeed({
          sessionId: AuthSessionId.make("test-session"),
          subject: "test-user",
          method: "bearer-access-token",
          scopes: [AuthOrchestrationOperateScope],
        }),
    } as unknown as EnvironmentAuth.EnvironmentAuth["Service"]);

    const routeLayer = desktopSshBootstrapBearerRouteLayer as Layer.Layer<
      never,
      never,
      HttpRouter.HttpRouter | EnvironmentAuth.EnvironmentAuth | HttpClient.HttpClient
    >;

    const { handler, dispose } = HttpRouter.toWebHandler(
      routeLayer.pipe(
        Layer.provideMerge(authLayer),
        Layer.provideMerge(Layer.succeed(HttpClient.HttpClient, mockHttpClient)),
      ),
      { disableLogger: true },
    );

    try {
      const response = await handler(
        new Request("http://127.0.0.1/api/desktop/ssh/bearer/bootstrap", {
          method: "POST",
          headers: {
            "content-type": "application/json",
            authorization: "Bearer local-test-token",
          },
          body: encodeJson({
            httpBaseUrl: "http://127.0.0.1:41773",
            credential: "remote-pairing-token",
          }),
        }),
      );

      expect(response.status).toBe(200);
      const body = await response.json();
      expect(body).toEqual({
        token: "mock-remote-bearer-token",
        scopes: [...AuthStandardClientScopes],
        expiresInSeconds: 3600,
      });

      expect(capturedRequest?.url).toBe("http://127.0.0.1:41773/api/auth/bearer-session");
      expect(capturedPayload).toEqual({
        credential: "remote-pairing-token",
        scopes: [...AuthStandardClientScopes],
      });
      expect((capturedPayload as { scopes: readonly string[] }).scopes).toContain(
        AuthTerminalOperateScope,
      );
    } finally {
      await dispose();
    }
  });
});
