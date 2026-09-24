import * as Effect from "effect/Effect";
import { FetchHttpClient } from "effect/unstable/http";

import type { PreparedConnection } from "../connection/model.ts";
import {
  executeEnvironmentHttpRequest,
  makeEnvironmentHttpApiGroupClient,
  RemoteEnvironmentAuthTimeoutError,
  type RemoteEnvironmentRequestError,
} from "../rpc/http.ts";

export interface EnvironmentHttpAuthHeaders {
  readonly authorization?: string;
}

const withEnvironmentCredentials = <A, E, R>(
  prepared: PreparedConnection,
  request: Effect.Effect<A, E, R>,
): Effect.Effect<A, E, R> =>
  prepared.httpAuthorization === null
    ? request.pipe(Effect.provideService(FetchHttpClient.RequestInit, { credentials: "include" }))
    : request;

export const executeAuthenticatedEnvironmentHttpRequest = Effect.fn(
  "clientRuntime.state.executeAuthenticatedEnvironmentHttpRequest",
)(function* <
  Group extends Parameters<typeof makeEnvironmentHttpApiGroupClient>[1],
  A,
  E,
  R,
>(input: {
  readonly prepared: PreparedConnection;
  readonly method: "GET" | "POST";
  readonly url: (httpBaseUrl: string) => string;
  readonly timeoutMs: number;
  readonly group: Group;
  readonly request: (input: {
    readonly client: Effect.Success<ReturnType<typeof makeEnvironmentHttpApiGroupClient<Group>>>;
    readonly headers: EnvironmentHttpAuthHeaders;
  }) => Effect.Effect<A, E, R>;
}): Effect.fn.Return<
  A,
  RemoteEnvironmentRequestError,
  Effect.Services<ReturnType<typeof makeEnvironmentHttpApiGroupClient<Group>>> | R
> {
  const { prepared } = input;
  const requestUrl = input.url(prepared.httpBaseUrl);
  const client = yield* makeEnvironmentHttpApiGroupClient(prepared.httpBaseUrl, input.group);
  const headers: EnvironmentHttpAuthHeaders =
    prepared.httpAuthorization === null
      ? {}
      : { authorization: `Bearer ${prepared.httpAuthorization.token}` };
  return yield* executeEnvironmentHttpRequest(
    requestUrl,
    input.timeoutMs,
    withEnvironmentCredentials(prepared, input.request({ client, headers })),
  ).pipe(
    Effect.timeoutOrElse({
      duration: input.timeoutMs,
      orElse: () => Effect.fail(new RemoteEnvironmentAuthTimeoutError(requestUrl, input.timeoutMs)),
    }),
  );
});
