// @effect-diagnostics anyUnknownInErrorContext:off unsafeEffectTypeAssertion:off
import {
  AuthOrchestrationOperateScope,
  AuthOrchestrationReadScope,
  AuthStandardClientScopes,
  DesktopDiscoveredSshHostSchema,
  DesktopSshBearerBootstrapInputSchema,
  DesktopSshBearerRequestInputSchema,
  DesktopSshEnvironmentEnsureInputSchema,
  DesktopSshEnvironmentEnsureResultSchema,
  DesktopSshEnvironmentPlanSchema,
  DesktopSshEnvironmentProgressSchema,
  DesktopSshHostKeyAcceptanceSchema,
  DesktopSshEnvironmentTargetSchema,
  DesktopSshPasswordPromptCancelledType,
  DesktopSshPasswordPromptResolutionInputSchema,
  type ConnectionFailureCode,
  EnvironmentAuthInvalidError,
  EnvironmentInternalError,
  EnvironmentOperationForbiddenError,
  EnvironmentRequestInvalidError,
  EnvironmentResourceNotFoundError,
  EnvironmentScopeRequiredError,
} from "@awen/contracts";
import {
  classifySshFailure,
  SshCommandError,
  SshHostDiscoveryError,
  SshHttpBridgeError,
  SshInvalidTargetError,
  SshLaunchError,
  SshPairingError,
  SshReadinessError,
} from "@awen/ssh/errors";
import { resolveLoopbackSshHttpBaseUrl } from "@awen/ssh/tunnel";
import * as NetService from "@awen/shared/Net";
import {
  environmentEndpointUrl,
  executeEnvironmentHttpRequest,
  makeEnvironmentHttpApiGroupClient,
  RemoteEnvironmentAuthUndeclaredStatusError,
  type RemoteEnvironmentRequestError,
} from "@awen/shared/remoteEnvironmentHttp";
import * as Data from "effect/Data";
import * as Effect from "effect/Effect";
import * as Fiber from "effect/Fiber";
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
import { SshEnvironmentProgress, sshProgress } from "@awen/ssh/progress";

const DESKTOP_SSH_ROUTE_PREFIX = "/api/desktop/ssh";
const DEFAULT_REMOTE_REQUEST_TIMEOUT_MS = 10_000;
const encodeDesktopSshEnvironmentPlan = Schema.encodeEffect(DesktopSshEnvironmentPlanSchema);
const sshEnsureOperations = new Map<
  string,
  {
    progress: typeof DesktopSshEnvironmentProgressSchema.Type;
    cancel: (() => Promise<void>) | null;
  }
>();
const sshOperationInputSchema = Schema.Struct({ operationId: Schema.String });

const executeSshRemoteRequest = <A, E, R>(
  httpBaseUrl: string,
  pathname: string,
  request: Effect.Effect<A, E, R>,
) =>
  executeEnvironmentHttpRequest(
    environmentEndpointUrl(httpBaseUrl, pathname),
    DEFAULT_REMOTE_REQUEST_TIMEOUT_MS,
    request,
  );

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
  readonly failureCode: ConnectionFailureCode;
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

export const sshErrorStatus = (error: unknown): number => {
  if (error instanceof SshInvalidTargetError) return 400;
  const failureCode = classifySshFailure(error).code;
  switch (failureCode) {
    case "ssh-authentication":
    case "daemon-authentication":
      return 401;
    case "host-key-change":
    case "protocol-mismatch":
      return 409;
    case "prerequisite-missing":
      return 422;
    case "install-download-checksum":
    case "daemon-start":
    case "unreachable":
      return 502;
    case "unknown":
      return error instanceof SshCommandError ||
        error instanceof SshHostDiscoveryError ||
        error instanceof SshLaunchError ||
        error instanceof SshPairingError ||
        error instanceof SshReadinessError ||
        error instanceof NetService.NetError
        ? 502
        : 500;
  }
};

const sshErrorResponse = (error: unknown) => {
  const failure = classifySshFailure(error);
  return HttpServerResponse.jsonUnsafe(
    {
      error: {
        code: failure.code,
        message: failure.detail,
      },
    },
    { status: sshErrorStatus(error) },
  );
};

export const remoteRequestFailureCode = (
  operation: DesktopSshEnvironmentRequestOperation,
  cause: DesktopSshEnvironmentRequestCause,
  status: number | null,
): ConnectionFailureCode => {
  if (
    Schema.is(EnvironmentAuthInvalidError)(cause) ||
    Schema.is(EnvironmentScopeRequiredError)(cause) ||
    Schema.is(EnvironmentOperationForbiddenError)(cause)
  ) {
    return "daemon-authentication";
  }
  if (status === 401 || status === 403) return "daemon-authentication";
  if (
    operation === "fetch-environment-descriptor" &&
    (status === 404 ||
      Schema.is(EnvironmentRequestInvalidError)(cause) ||
      Schema.is(EnvironmentResourceNotFoundError)(cause))
  ) {
    return "protocol-mismatch";
  }
  return "daemon-start";
};

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
            failureCode: remoteRequestFailureCode(operation, cause, readSshHttpStatus(cause)),
          }),
      ),
    );

export const sshRequestErrorStatus = (error: DesktopSshEnvironmentRequestError): number => {
  if (error.failureCode === "daemon-authentication") return 401;
  if (error.failureCode === "protocol-mismatch") return 409;
  return error.sshHttpStatus ?? 502;
};

const sshRequestErrorResponse = (error: DesktopSshEnvironmentRequestError) =>
  HttpServerResponse.jsonUnsafe(
    { error: { code: error.failureCode, message: error.message } },
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

const fetchRemoteEnvironmentDescriptor = Effect.fn("desktop.ssh.fetchRemoteEnvironmentDescriptor")(
  function* (httpBaseUrl: string) {
    const client = yield* makeEnvironmentHttpApiGroupClient(httpBaseUrl, "metadata");
    return yield* executeSshRemoteRequest(
      httpBaseUrl,
      "/.well-known/awen/environment",
      client.descriptor(),
    );
  },
);

const bootstrapRemoteBearerSession = Effect.fn("desktop.ssh.bootstrapRemoteBearerSession")(
  function* (input: { readonly httpBaseUrl: string; readonly credential: string }) {
    const client = yield* makeEnvironmentHttpApiGroupClient(input.httpBaseUrl, "auth");
    return yield* executeSshRemoteRequest(
      input.httpBaseUrl,
      "/api/auth/bearer-session",
      client.bearerSession({
        payload: {
          credential: input.credential,
          scopes: [...AuthStandardClientScopes],
        },
      }),
    );
  },
);

const fetchRemoteSessionState = Effect.fn("desktop.ssh.fetchRemoteSessionState")(function* (input: {
  readonly httpBaseUrl: string;
  readonly bearerToken: string;
}) {
  const client = yield* makeEnvironmentHttpApiGroupClient(input.httpBaseUrl, "auth");
  return yield* executeSshRemoteRequest(
    input.httpBaseUrl,
    "/api/auth/session",
    client.session({
      headers: {
        authorization: `Bearer ${input.bearerToken}`,
      },
    }),
  );
});

const issueRemoteWebSocketTicket = Effect.fn("desktop.ssh.issueRemoteWebSocketTicket")(
  function* (input: { readonly httpBaseUrl: string; readonly bearerToken: string }) {
    const client = yield* makeEnvironmentHttpApiGroupClient(input.httpBaseUrl, "auth");
    return yield* executeSshRemoteRequest(
      input.httpBaseUrl,
      "/api/auth/websocket-ticket",
      client.webSocketTicket({
        headers: {
          authorization: `Bearer ${input.bearerToken}`,
        },
      }),
    );
  },
);

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

export const desktopSshInspectRouteLayer = HttpRouter.add(
  "POST",
  `${DESKTOP_SSH_ROUTE_PREFIX}/plan`,
  withRouteErrors(
    Effect.gen(function* () {
      yield* annotateEnvironmentRequest("desktop.ssh.plan");
      yield* authenticateRawRouteWithScope(AuthOrchestrationReadScope);
      const target = yield* decodeJsonBody(DesktopSshEnvironmentTargetSchema);
      const ssh = yield* DesktopSshEnvironment.DesktopSshEnvironment;
      return HttpServerResponse.jsonUnsafe(
        yield* encodeDesktopSshEnvironmentPlan(yield* ssh.inspectEnvironment(target)),
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
      const operationId = input.options?.operationId;
      const operation = operationId
        ? {
            progress: sshProgress("connecting"),
            cancel: null as (() => Promise<void>) | null,
          }
        : null;
      if (operationId && operation) sshEnsureOperations.set(operationId, operation);
      const ensureWithProgress = operation
        ? ssh.ensureEnvironment(input.target, input.options).pipe(
            Effect.provideService(
              SshEnvironmentProgress,
              SshEnvironmentProgress.of({
                report: (progress) => {
                  operation.progress = progress;
                },
              }),
            ),
          )
        : ssh.ensureEnvironment(input.target, input.options);
      const ensure = ensureWithProgress.pipe(
        Effect.catch((error) =>
          DesktopSshEnvironment.isDesktopSshPasswordPromptCancellation(error)
            ? Effect.succeed({
                type: DesktopSshPasswordPromptCancelledType,
                message: error.message,
              })
            : Effect.fail(error),
        ),
      );
      const fiber = yield* ensure.pipe(Effect.forkChild);
      if (operation)
        operation.cancel = () => Effect.runPromise(Fiber.interrupt(fiber)).then(() => {});
      const bootstrap = yield* Fiber.join(fiber).pipe(
        Effect.ensuring(
          Effect.gen(function* () {
            if (operation) operation.cancel = null;
            if (operationId) {
              yield* Effect.sleep(60_000).pipe(
                Effect.andThen(Effect.sync(() => sshEnsureOperations.delete(operationId))),
                Effect.forkDetach,
              );
            }
          }),
        ),
      );
      return HttpServerResponse.jsonUnsafe(
        yield* Schema.encodeEffect(DesktopSshEnvironmentEnsureResultSchema)(bootstrap),
      );
    }),
  ),
);

export const desktopSshProgressRouteLayer = HttpRouter.add(
  "POST",
  `${DESKTOP_SSH_ROUTE_PREFIX}/progress`,
  withRouteErrors(
    Effect.gen(function* () {
      yield* annotateEnvironmentRequest("desktop.ssh.progress");
      yield* authenticateRawRouteWithScope(AuthOrchestrationOperateScope);
      const { operationId } = yield* decodeJsonBody(sshOperationInputSchema);
      return HttpServerResponse.jsonUnsafe(sshEnsureOperations.get(operationId)?.progress ?? null);
    }),
  ),
);

export const desktopSshCancelRouteLayer = HttpRouter.add(
  "POST",
  `${DESKTOP_SSH_ROUTE_PREFIX}/cancel`,
  withRouteErrors(
    Effect.gen(function* () {
      yield* annotateEnvironmentRequest("desktop.ssh.cancel");
      yield* authenticateRawRouteWithScope(AuthOrchestrationOperateScope);
      const { operationId } = yield* decodeJsonBody(sshOperationInputSchema);
      const cancel = sshEnsureOperations.get(operationId)?.cancel;
      if (cancel) yield* Effect.promise(cancel);
      return HttpServerResponse.empty({ status: 204 });
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
      const input = yield* decodeJsonBody(DesktopSshHostKeyAcceptanceSchema);
      const ssh = yield* DesktopSshEnvironment.DesktopSshEnvironment;
      yield* ssh.trustHost(input.target, input.keyType, input.fingerprint);
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
        yield* withLoopbackSshApi(
          "fetch-environment-descriptor",
          fetchRemoteEnvironmentDescriptor,
        )(input.httpBaseUrl),
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
  desktopSshInspectRouteLayer,
  desktopSshEnsureRouteLayer,
  desktopSshProgressRouteLayer,
  desktopSshCancelRouteLayer,
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
