import type { DispatchResult, OrchestrationCommand } from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";

import type { ProjectionSnapshotQueryShape } from "./Services/ProjectionSnapshotQuery.ts";

/**
 * Enrich successful thread creation, including bootstrap creation, with the
 * durable ACode identity. The enrichment is additive so older projection
 * services can still acknowledge the underlying T3 command.
 */
export function enrichOrchestrationDispatchResult(input: {
  readonly command: OrchestrationCommand;
  readonly result: DispatchResult;
  readonly readAcodeAgentSessionByThreadId?: ProjectionSnapshotQueryShape["getAcodeAgentSessionByThreadId"];
}): Effect.Effect<DispatchResult> {
  const { command, result, readAcodeAgentSessionByThreadId } = input;
  const threadId =
    command.type === "thread.create" ||
    (command.type === "thread.turn.start" && command.bootstrap?.createThread !== undefined)
      ? command.threadId
      : null;
  if (threadId === null || readAcodeAgentSessionByThreadId === undefined) {
    return Effect.succeed(result);
  }

  return readAcodeAgentSessionByThreadId(threadId).pipe(
    Effect.map((session) =>
      Option.isSome(session)
        ? { ...result, agentSession: session.value }
        : { ...result, agentSessionError: "workspace-unbound" as const },
    ),
    Effect.catchCause(() => Effect.succeed(result)),
  );
}
