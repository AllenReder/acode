// @effect-diagnostics anyUnknownInErrorContext:off unsafeEffectTypeAssertion:off
import {
  AuthAccessTokenType,
  AuthEnvironmentBootstrapTokenType,
  AuthTokenExchangeGrantType,
  AuthOrchestrationOperateScope,
  AuthOrchestrationReadScope,
  DesktopDiscoveredSshHostSchema,
  DesktopSshBearerBootstrapInputSchema,
  DesktopSshBearerRequestInputSchema,
  DesktopSshEnvironmentEnsureInputSchema,
  DesktopSshEnvironmentTargetSchema,
  DesktopSshPasswordPromptCancelledType,
  DesktopSshPasswordPromptResolutionInputSchema,
  EnvironmentAuthInvalidError,
  EnvironmentInternalError,
  EnvironmentScopeRequiredError,
} from "@t3tools/contracts";
import {
  SshCommandError,
  SshHostDiscoveryError,
  SshHttpBridgeError,
  SshInvalidTargetError,
  SshLaunchError,
  SshPairingError,
  SshPasswordPromptError,
  SshReadinessError,
} from "@t3tools/ssh/errors";
import { resolveLoopbackSshHttpBaseUrl } from "@t3tools/ssh/tunnel";
import * as NetService from "@t3tools/shared/Net";
import { encodeOAuthScope } from "@t3tools/shared/oauthScope";
import {
  environmentEndpointUrl,
  executeEnvironmentHttpRequest,
  makeEnvironmentHttpApiGroupClient,
  RemoteEnvironmentAuthUndeclaredStatusError,
  type RemoteEnvironmentRequestError,
} from "@t3tools/shared/remoteEnvironmentHttp";
import * as Data from "effect/Data";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Scope from "effect/Scope";
import * as Schema from "effect/Schema";
import {
  HttpClient,
  HttpRouter,
  HttpServerRequest,
  HttpServerRespondable,
  HttpServerResponse,
} from "effect/unstable/http";

import { annotateEnvironmentRequest } from "../auth/http.ts";
import { authenticateRawRouteWithScope } from "../http.ts";
import * as EnvironmentAuth from "../auth/EnvironmentAuth.ts";
import * as DesktopSshEnvironment from "./sshEnvironment.ts";
import * as DesktopSshPasswordPrompts from "./sshPasswordPrompts.ts";

const DESKTOP_SSH_ROUTE_PREFIX = "/api/desktop/ssh";
const DEFAULT_REMOTE_REQUEST_TIMEOUT_MS = 10_000;

type DesktopSshEnvironmentRequestOperation =
  | "fetch-environment-descriptor"
  | "bootstrap-bearer-session"
  | "fetch-session-state"
  | "issue-websocket-ticket";

type DesktopSshEnvironmentRequestCause = RemoteEnvironmentRequestError | SshHttpBridgeError;

export class DesktopSshEnvironmentRequestError extends Data.TaggedError(
  "DesktopSshEnvironmentRequestError",
)<{
  readonly operation: DesktopSshEnvironmentRequestOperation;
  readonly cause: DesktopSshEnvironmentRequestCause;
  readonly sshHttpStatus: number | null;
}> {
  override get message() {
    const prefix = this.sshHttpStatus === null ? "" : `[ssh_http:${this.sshHttpStatus}] `;
    return `${prefix}SSH remote API request failed during ${this.operation}.`;
  }
}

const decodeJsonBody = <A>(schema: Schema.Schema<A>) =>
  Effect.gen(function* () {
    const request = yield* HttpServerRequest.HttpServerRequest;
    const body = yield* request.json;
    return yield* Schema.decodeUnknownEffect(schema)(body);
  });

const sshErrorStatus = (error: unknown): number => {
  if (error instanceof SshInvalidTargetError) return 400;
  if (error instanceof SshPasswordPromptError) return 401;
  if (error instanceof SshCommandError) return 502;
  if (error instanceof SshHostDiscoveryError) return 502;
  if (
    error instanceof SshLaunchError ||
    error instanceof SshPairingError ||
    error instanceof SshReadinessError ||
    error instanceof NetService.NetError
  ) {
    return 502;
  }
  return 500;
};

const sshErrorResponse = (error: unknown) =>
  HttpServerResponse.jsonUnsafe(
    {
      error: {
        message: error instanceof Error ? error.message : String(error),
      },
    },
    { status: sshErrorStatus(error) },
  );

const readSshHttpStatus = (cause: DesktopSshEnvironmentRequestCause): number | null => {
  if (
    cause instanceof RemoteEnvironmentAuthUndeclaredStatusError ||
    cause instanceof SshHttpBridgeError
  ) {
    return cause.status ?? null;
  }
  return null;
};

const withLoopbackSshApi =
  <A, R>(
    operation: DesktopSshEnvironmentRequestOperation,
    use: (httpBaseUrl: string) => Effect.Effect<A, RemoteEnvironmentRequestError, R>,
  ) =>
  (httpBaseUrl: string): Effect.Effect<A, DesktopSshEnvironmentRequestError, R> =>
    resolveLoopbackSshHttpBaseUrl(httpBaseUrl).pipe(
      Effect.flatMap(use),
      Effect.mapError(
        (cause) =>
          new DesktopSshEnvironmentRequestError({
            operation,
            cause,
            sshHttpStatus: readSshHttpStatus(cause),
          }),
      ),
    );

const sshRequestErrorStatus = (error: DesktopSshEnvironmentRequestError): number =>
  error.sshHttpStatus ?? 502;

const sshRequestErrorResponse = (error: DesktopSshEnvironmentRequestError) =>
  HttpServerResponse.jsonUnsafe(
    { error: { message: error.message } },
    { status: sshRequestErrorStatus(error) },
  );

const withRouteErrors = <E, R>(
  effect: Effect.Effect<HttpServerResponse.HttpServerResponse, E, R>,
): Effect.Effect<HttpServerResponse.HttpServerResponse, never, R> =>
  effect.pipe(
    Effect.catch((error) => {
      if (
        Schema.is(EnvironmentAuthInvalidError)(error) ||
        Schema.is(EnvironmentInternalError)(error) ||
        Schema.is(EnvironmentScopeRequiredError)(error)
      ) {
        return HttpServerRespondable.toResponse(error);
      }
      if (error instanceof DesktopSshEnvironmentRequestError) {
        return Effect.succeed(sshRequestErrorResponse(error));
      }
      return Effect.succeed(sshErrorResponse(error));
    }),
  );

const fetchRemoteEnvironmentDescriptor = Effect.fn(
  "desktop.ssh.fetchRemoteEnvironmentDescriptor",
)(function* (httpBaseUrl: string) {
  const client = yield* makeEnvironmentHttpApiGroupClient(httpBaseUrl, "metadata");
  return yield* executeEnvironmentHttpRequest(
    environmentEndpointUrl(httpBaseUrl, "/.well-known/t3/environment"),
    DEFAULT_REMOTE_REQUEST_TIMEOUT_MS,
    client.descriptor(),
  );
});

const bootstrapRemoteBearerSession = Effect.fn(
  "desktop.ssh.bootstrapRemoteBearerSession",
)(function* (input: { readonly httpBaseUrl: string; readonly credential: string }) {
  const client = yield* makeEnvironmentHttpApiGroupClient(input.httpBaseUrl, "auth");
  return yield* executeEnvironmentHttpRequest(
    environmentEndpointUrl(input.httpBaseUrl, "/oauth/token"),
    DEFAULT_REMOTE_REQUEST_TIMEOUT_MS,
    client.token({
      headers: {},
      payload: {
        grant_type: AuthTokenExchangeGrantType,
        subject_token: input.credential,
        subject_token_type: AuthEnvironmentBootstrapTokenType,
        requested_token_type: AuthAccessTokenType,
        scope: encodeOAuthScope([AuthOrchestrationReadScope, AuthOrchestrationOperateScope]),
      },
    }),
  );
});

const fetchRemoteSessionState = Effect.fn(
  "desktop.ssh.fetchRemoteSessionState",
)(function* (input: { readonly httpBaseUrl: string; readonly bearerToken: string }) {
  const client = yield* makeEnvironmentHttpApiGroupClient(input.httpBaseUrl, "auth");
  return yield* executeEnvironmentHttpRequest(
    environmentEndpointUrl(input.httpBaseUrl, "/api/auth/session"),
    DEFAULT_REMOTE_REQUEST_TIMEOUT_MS,
    client.session({
      headers: {
        authorization: `Bearer ${input.bearerToken}`,
      },
    }),
  );
});

const issueRemoteWebSocketTicket = Effect.fn(
  "desktop.ssh.issueRemoteWebSocketTicket",
)(function* (input: { readonly httpBaseUrl: string; readonly bearerToken: string }) {
  const client = yield* makeEnvironmentHttpApiGroupClient(input.httpBaseUrl, "auth");
  return yield* executeEnvironmentHttpRequest(
    environmentEndpointUrl(input.httpBaseUrl, "/api/auth/websocket-ticket"),
    DEFAULT_REMOTE_REQUEST_TIMEOUT_MS,
    client.webSocketTicket({
      headers: {
        authorization: `Bearer ${input.bearerToken}`,
      },
    }),
  );
});

export const desktopSshHostsRouteLayer = HttpRouter.add(
  "GET",
  `${DESKTOP_SSH_ROUTE_PREFIX}/hosts`,
  withRouteErrors(
    Effect.gen(function* () {
      yield* annotateEnvironmentRequest("desktop.ssh.hosts");
      yield* authenticateRawRouteWithScope(AuthOrchestrationReadScope);
      const ssh = yield* DesktopSshEnvironment.DesktopSshEnvironment;
      const hosts = yield* ssh.discoverHosts();
      return HttpServerResponse.jsonUnsafe(
        yield* Schema.encodeEffect(Schema.Array(DesktopDiscoveredSshHostSchema))(hosts),
      );
    }),
  ),
);

export const desktopSshResolveHostRouteLayer = HttpRouter.add(
  "POST",
  `${DESKTOP_SSH_ROUTE_PREFIX}/hosts/resolve`,
  withRouteErrors(
    Effect.gen(function* () {
      yield* annotateEnvironmentRequest("desktop.ssh.resolveHost");
      yield* authenticateRawRouteWithScope(AuthOrchestrationReadScope);
      const input = yield* decodeJsonBody(Schema.Struct({ alias: Schema.String }));
      const ssh = yield* DesktopSshEnvironment.DesktopSshEnvironment;
      const target = yield* ssh.resolveHost(input.alias);
      return HttpServerResponse.jsonUnsafe(
        yield* Schema.encodeEffect(DesktopSshEnvironmentTargetSchema)(target),
      );
    }),
  ),
);

export const desktopSshEnsureRouteLayer = HttpRouter.add(
  "POST",
  `${DESKTOP_SSH_ROUTE_PREFIX}/ensure`,
  withRouteErrors(
    Effect.gen(function* () {
      yield* annotateEnvironmentRequest("desktop.ssh.ensure");
      yield* authenticateRawRouteWithScope(AuthOrchestrationOperateScope);
      const input = yield* decodeJsonBody(DesktopSshEnvironmentEnsureInputSchema);
      const ssh = yield* DesktopSshEnvironment.DesktopSshEnvironment;
      const bootstrap = yield* ssh.ensureEnvironment(input.target, input.options).pipe(
        Effect.catch((error) =>
          DesktopSshEnvironment.isDesktopSshPasswordPromptCancellation(error)
            ? Effect.succeed({
                type: DesktopSshPasswordPromptCancelledType,
                message: error.message,
              })
            : Effect.fail(error),
        ),
      );
      return HttpServerResponse.jsonUnsafe(bootstrap);
    }),
  ),
);

export const desktopSshDisconnectRouteLayer = HttpRouter.add(
  "POST",
  `${DESKTOP_SSH_ROUTE_PREFIX}/disconnect`,
  withRouteErrors(
    Effect.gen(function* () {
      yield* annotateEnvironmentRequest("desktop.ssh.disconnect");
      yield* authenticateRawRouteWithScope(AuthOrchestrationOperateScope);
      const target = yield* decodeJsonBody(DesktopSshEnvironmentTargetSchema);
      const ssh = yield* DesktopSshEnvironment.DesktopSshEnvironment;
      yield* ssh.disconnectEnvironment(target);
      return HttpServerResponse.empty({ status: 204 });
    }),
  ),
);

export const desktopSshTrustRouteLayer = HttpRouter.add(
  "POST",
  `${DESKTOP_SSH_ROUTE_PREFIX}/trust`,
  withRouteErrors(
    Effect.gen(function* () {
      yield* annotateEnvironmentRequest("desktop.ssh.trust");
      yield* authenticateRawRouteWithScope(AuthOrchestrationReadScope);
      const target = yield* decodeJsonBody(DesktopSshEnvironmentTargetSchema);
      const ssh = yield* DesktopSshEnvironment.DesktopSshEnvironment;
      return HttpServerResponse.jsonUnsafe(yield* ssh.inspectTrust(target));
    }),
  ),
);

export const desktopSshTrustAcceptRouteLayer = HttpRouter.add(
  "POST",
  `${DESKTOP_SSH_ROUTE_PREFIX}/trust/accept`,
  withRouteErrors(
    Effect.gen(function* () {
      yield* annotateEnvironmentRequest("desktop.ssh.trustAccept");
      yield* authenticateRawRouteWithScope(AuthOrchestrationOperateScope);
      const target = yield* decodeJsonBody(DesktopSshEnvironmentTargetSchema);
      const ssh = yield* DesktopSshEnvironment.DesktopSshEnvironment;
      yield* ssh.trustHost(target);
      return HttpServerResponse.empty({ status: 204 });
    }),
  ),
);

export const desktopSshDescriptorRouteLayer = HttpRouter.add(
  "POST",
  `${DESKTOP_SSH_ROUTE_PREFIX}/descriptor`,
  withRouteErrors(
    Effect.gen(function* () {
      yield* annotateEnvironmentRequest("desktop.ssh.descriptor");
      yield* authenticateRawRouteWithScope(AuthOrchestrationReadScope);
      const input = yield* decodeJsonBody(Schema.Struct({ httpBaseUrl: Schema.String }));
      return HttpServerResponse.jsonUnsafe(
        yield* withLoopbackSshApi("fetch-environment-descriptor", fetchRemoteEnvironmentDescriptor)(
          input.httpBaseUrl,
        ),
      );
    }),
  ),
);

export const desktopSshBootstrapBearerRouteLayer = HttpRouter.add(
  "POST",
  `${DESKTOP_SSH_ROUTE_PREFIX}/bearer/bootstrap`,
  withRouteErrors(
    Effect.gen(function* () {
      yield* annotateEnvironmentRequest("desktop.ssh.bootstrapBearer");
      yield* authenticateRawRouteWithScope(AuthOrchestrationOperateScope);
      const input = yield* decodeJsonBody(DesktopSshBearerBootstrapInputSchema);
      return HttpServerResponse.jsonUnsafe(
        yield* withLoopbackSshApi("bootstrap-bearer-session", (httpBaseUrl) =>
          bootstrapRemoteBearerSession({ httpBaseUrl, credential: input.credential }),
        )(input.httpBaseUrl),
      );
    }),
  ),
);

export const desktopSshSessionStateRouteLayer = HttpRouter.add(
  "POST",
  `${DESKTOP_SSH_ROUTE_PREFIX}/bearer/session`,
  withRouteErrors(
    Effect.gen(function* () {
      yield* annotateEnvironmentRequest("desktop.ssh.sessionState");
      yield* authenticateRawRouteWithScope(AuthOrchestrationReadScope);
      const input = yield* decodeJsonBody(DesktopSshBearerRequestInputSchema);
      return HttpServerResponse.jsonUnsafe(
        yield* withLoopbackSshApi("fetch-session-state", (httpBaseUrl) =>
          fetchRemoteSessionState({ httpBaseUrl, bearerToken: input.bearerToken }),
        )(input.httpBaseUrl),
      );
    }),
  ),
);

export const desktopSshWebSocketTicketRouteLayer = HttpRouter.add(
  "POST",
  `${DESKTOP_SSH_ROUTE_PREFIX}/bearer/ws-ticket`,
  withRouteErrors(
    Effect.gen(function* () {
      yield* annotateEnvironmentRequest("desktop.ssh.wsTicket");
      yield* authenticateRawRouteWithScope(AuthOrchestrationOperateScope);
      const input = yield* decodeJsonBody(DesktopSshBearerRequestInputSchema);
      return HttpServerResponse.jsonUnsafe(
        yield* withLoopbackSshApi("issue-websocket-ticket", (httpBaseUrl) =>
          issueRemoteWebSocketTicket({ httpBaseUrl, bearerToken: input.bearerToken }),
        )(input.httpBaseUrl),
      );
    }),
  ),
);

export const desktopSshPasswordPromptsRouteLayer = HttpRouter.add(
  "GET",
  `${DESKTOP_SSH_ROUTE_PREFIX}/password-prompts`,
  withRouteErrors(
    Effect.gen(function* () {
      yield* annotateEnvironmentRequest("desktop.ssh.passwordPrompts");
      yield* authenticateRawRouteWithScope(AuthOrchestrationReadScope);
      const prompts = yield* DesktopSshPasswordPrompts.DesktopSshPasswordPrompts;
      return HttpServerResponse.jsonUnsafe(yield* prompts.listPending);
    }),
  ),
);

export const desktopSshResolvePasswordPromptRouteLayer = HttpRouter.add(
  "POST",
  `${DESKTOP_SSH_ROUTE_PREFIX}/password-prompts/resolve`,
  withRouteErrors(
    Effect.gen(function* () {
      yield* annotateEnvironmentRequest("desktop.ssh.resolvePasswordPrompt");
      yield* authenticateRawRouteWithScope(AuthOrchestrationOperateScope);
      const input = yield* decodeJsonBody(DesktopSshPasswordPromptResolutionInputSchema);
      const prompts = yield* DesktopSshPasswordPrompts.DesktopSshPasswordPrompts;
      yield* prompts.resolve(input);
      return HttpServerResponse.empty({ status: 204 });
    }),
  ),
);

type DesktopSshRouteLayer = Layer.Layer<
  never,
  never,
  | DesktopSshEnvironment.DesktopSshEnvironment
  | DesktopSshPasswordPrompts.DesktopSshPasswordPrompts
  | EnvironmentAuth.EnvironmentAuth
  | HttpClient.HttpClient
  | Scope.Scope
>;

export const desktopSshRouteLayer: DesktopSshRouteLayer = Layer.mergeAll(
  desktopSshHostsRouteLayer,
  desktopSshResolveHostRouteLayer,
  desktopSshEnsureRouteLayer,
  desktopSshTrustRouteLayer,
  desktopSshTrustAcceptRouteLayer,
  desktopSshDisconnectRouteLayer,
  desktopSshDescriptorRouteLayer,
  desktopSshBootstrapBearerRouteLayer,
  desktopSshSessionStateRouteLayer,
  desktopSshWebSocketTicketRouteLayer,
  desktopSshPasswordPromptsRouteLayer,
  desktopSshResolvePasswordPromptRouteLayer,
) as unknown as DesktopSshRouteLayer;
