import {
  combineTerminalSessionState,
  EMPTY_TERMINAL_BUFFER_STATE,
  EMPTY_TERMINAL_SESSION_STATE,
  selectRunningSubprocessTerminalIds,
  type KnownTerminalSession,
  type TerminalSessionState,
} from "@awen/client-runtime/state/terminal";
import {
  ThreadId,
  WorkspaceId,
  type EnvironmentId,
  type TerminalAttachInput,
  type TerminalSummary,
} from "@awen/contracts";
import { useMemo } from "react";

import { useEnvironmentQuery } from "./query";
import { terminalEnvironment } from "./terminal";

const EMPTY_KNOWN_TERMINAL_SESSIONS = Object.freeze<ReadonlyArray<KnownTerminalSession>>([]);

interface TerminalMetadataIndex {
  readonly all: ReadonlyArray<TerminalSummary>;
  readonly byThreadId: ReadonlyMap<string, ReadonlyArray<TerminalSummary>>;
  readonly byWorkspaceId: ReadonlyMap<string, ReadonlyArray<TerminalSummary>>;
  readonly views: Map<EnvironmentId, Map<string, ReadonlyArray<KnownTerminalSession>>>;
}

const metadataIndexes = new WeakMap<ReadonlyArray<TerminalSummary>, TerminalMetadataIndex>();
const sessionsBySummary = new WeakMap<TerminalSummary, Map<EnvironmentId, KnownTerminalSession>>();
// Reuse groups a consumer still holds without keeping old group members alive
// merely because their first summary remains in a newer metadata snapshot.
const groupsByAnchor = new WeakMap<
  TerminalSummary,
  Map<
    EnvironmentId,
    {
      readonly all?: WeakRef<ReadonlyArray<KnownTerminalSession>>;
      readonly thread?: WeakRef<ReadonlyArray<KnownTerminalSession>>;
      readonly workspace?: WeakRef<ReadonlyArray<KnownTerminalSession>>;
    }
  >
>();

function knownSession(
  summary: TerminalSummary,
  environmentId: EnvironmentId,
): KnownTerminalSession {
  let byEnvironment = sessionsBySummary.get(summary);
  const previous = byEnvironment?.get(environmentId);
  if (previous) return previous;
  const session = {
    target: {
      environmentId,
      ...(summary.workspaceId !== undefined
        ? { workspaceId: WorkspaceId.make(summary.workspaceId) }
        : { threadId: ThreadId.make(summary.threadId ?? "unknown") }),
      terminalId: summary.terminalId,
    },
    state: combineTerminalSessionState(summary, EMPTY_TERMINAL_BUFFER_STATE),
  };
  if (!byEnvironment) {
    byEnvironment = new Map();
    sessionsBySummary.set(summary, byEnvironment);
  }
  byEnvironment.set(environmentId, session);
  return session;
}

function terminalMetadataIndex(metadata: ReadonlyArray<TerminalSummary>): TerminalMetadataIndex {
  let index = metadataIndexes.get(metadata);
  if (!index) {
    const compare = new Intl.Collator(undefined, { numeric: true }).compare;
    const all = metadata.toSorted((left, right) => compare(left.terminalId, right.terminalId));
    const byThreadId = new Map<string, TerminalSummary[]>();
    const byWorkspaceId = new Map<string, TerminalSummary[]>();
    for (const summary of all) {
      if (summary.workspaceId !== undefined) {
        const group = byWorkspaceId.get(summary.workspaceId);
        if (group) group.push(summary);
        else byWorkspaceId.set(summary.workspaceId, [summary]);
      } else if (summary.threadId !== undefined) {
        const group = byThreadId.get(summary.threadId);
        if (group) group.push(summary);
        else byThreadId.set(summary.threadId, [summary]);
      }
    }
    index = { all, byThreadId, byWorkspaceId, views: new Map() };
    metadataIndexes.set(metadata, index);
  }
  return index;
}

/** Share one ordered index per immutable snapshot without changing metadata subscriptions. */
export function selectKnownTerminalSessions(
  metadata: ReadonlyArray<TerminalSummary> | null,
  environmentId: EnvironmentId | null,
  threadId: ThreadId | null,
  workspaceId: WorkspaceId | null = null,
): ReadonlyArray<KnownTerminalSession> {
  if (environmentId === null || metadata === null || metadata.length === 0) {
    return EMPTY_KNOWN_TERMINAL_SESSIONS;
  }
  const index = terminalMetadataIndex(metadata);
  let views = index.views.get(environmentId);
  const selectorKey =
    workspaceId !== null ? `workspace:${workspaceId}` : `thread:${threadId ?? "*"}`;
  const cached = views?.get(selectorKey);
  if (cached) return cached;
  const summaries =
    workspaceId !== null
      ? index.byWorkspaceId.get(workspaceId)
      : threadId === null
        ? index.all
        : index.byThreadId.get(threadId);
  if (!summaries || summaries.length === 0) return EMPTY_KNOWN_TERMINAL_SESSIONS;

  const anchor = summaries[0]!;
  const kind = workspaceId !== null ? "workspace" : threadId === null ? "all" : "thread";
  let groups = groupsByAnchor.get(anchor);
  const previousGroups = groups?.get(environmentId);
  const previous = previousGroups?.[kind]?.deref();
  const sessions =
    previous?.length === summaries.length &&
    previous.every((session, index) => session.state.summary === summaries[index])
      ? previous
      : summaries.map((summary) => knownSession(summary, environmentId));
  if (!groups) {
    groups = new Map();
    groupsByAnchor.set(anchor, groups);
  }
  if (sessions !== previous) {
    groups.set(environmentId, { ...previousGroups, [kind]: new WeakRef(sessions) });
  }
  if (!views) {
    views = new Map();
    index.views.set(environmentId, views);
  }
  views.set(selectorKey, sessions);
  return sessions;
}

export function useAttachedTerminalSession(input: {
  readonly environmentId: EnvironmentId | null;
  readonly terminal: TerminalAttachInput | null;
}): TerminalSessionState {
  const attach = useEnvironmentQuery(
    input.environmentId !== null && input.terminal !== null
      ? terminalEnvironment.attach({
          environmentId: input.environmentId,
          input: input.terminal,
        })
      : null,
  );
  const metadata = useEnvironmentQuery(
    input.environmentId === null
      ? null
      : terminalEnvironment.metadata({
          environmentId: input.environmentId,
          input: null,
        }),
  );

  return useMemo(() => {
    if (input.environmentId === null || input.terminal === null) {
      return EMPTY_TERMINAL_SESSION_STATE;
    }
    const index = metadata.data === null ? null : terminalMetadataIndex(metadata.data);
    const ownerSummaries =
      index === null
        ? undefined
        : input.terminal.workspaceId !== undefined
          ? index.byWorkspaceId.get(input.terminal.workspaceId)
          : index.byThreadId.get(input.terminal.threadId ?? "");
    const summary =
      ownerSummaries?.find((terminal) => terminal.terminalId === input.terminal?.terminalId) ??
      null;
    const state = combineTerminalSessionState(summary, attach.data ?? EMPTY_TERMINAL_BUFFER_STATE);
    return attach.error === null ? state : { ...state, error: attach.error, status: "error" };
  }, [attach.data, attach.error, input.environmentId, input.terminal, metadata.data]);
}

export function useKnownTerminalSessions(input: {
  readonly environmentId: EnvironmentId | null;
  readonly threadId: ThreadId | null;
  readonly workspaceId?: WorkspaceId | null;
}): ReadonlyArray<KnownTerminalSession> {
  const metadata = useEnvironmentQuery(
    input.environmentId === null
      ? null
      : terminalEnvironment.metadata({
          environmentId: input.environmentId,
          input: null,
        }),
  );
  return useMemo(
    () =>
      selectKnownTerminalSessions(
        metadata.data,
        input.environmentId,
        input.threadId,
        input.workspaceId ?? null,
      ),
    [input.environmentId, input.threadId, input.workspaceId, metadata.data],
  );
}

export function useThreadRunningTerminalIds(input: {
  readonly environmentId: EnvironmentId | null;
  readonly threadId: ThreadId | null;
  readonly workspaceId?: WorkspaceId | null;
}): ReadonlyArray<string> {
  const sessions = useKnownTerminalSessions(input);
  return useMemo(() => selectRunningSubprocessTerminalIds(sessions), [sessions]);
}
