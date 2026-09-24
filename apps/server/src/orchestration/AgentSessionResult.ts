import type { DispatchResult, OrchestrationCommand } from "@awen/contracts";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";

import type { ProjectionSnapshotQueryShape } from "./Services/ProjectionSnapshotQuery.ts";

/**
 * Enrich successful thread creation, including bootstrap creation, with the
 * durable Awen identity. The enrichment is additive so older projection
 * services can still acknowledge the underlying Awen command.
 */
export function enrichOrchestrationDispatchResult(input: {
  readonly command: OrchestrationCommand;
  readonly result: DispatchResult;
  readonly readAwenAgentSessionByThreadId?: ProjectionSnapshotQueryShape["getAwenAgentSessionByThreadId"];
}): Effect.Effect<DispatchResult> {
  const { command, result, readAwenAgentSessionByThreadId } = input;
  const threadId =
    command.type === "thread.create" ||
    (command.type === "thread.turn.start" && command.bootstrap?.createThread !== undefined)
      ? command.threadId
      : null;
  if (threadId === null || readAwenAgentSessionByThreadId === undefined) {
    return Effect.succeed(result);
  }

  return readAwenAgentSessionByThreadId(threadId).pipe(
    Effect.map((session) =>
      Option.isSome(session)
        ? { ...result, agentSession: session.value }
        : { ...result, agentSessionError: "workspace-unbound" as const },
    ),
    Effect.catchCause(() => Effect.succeed(result)),
  );
}
