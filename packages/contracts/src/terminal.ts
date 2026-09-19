import * as Schema from "effect/Schema";
import { TerminalSessionId, TrimmedNonEmptyString } from "./baseSchemas.ts";
import { SessionKind } from "./session.ts";
import { ProviderInstanceId } from "./providerInstance.ts";

/**
 * Client-side id for the first shell opened on a thread. Ids are uniformly
 * `term-N`; there's no "default" intrinsic. Kept as a named constant so callers
 * that want "the primary shell" don't hardcode `"term-1"`.
 */
export const DEFAULT_TERMINAL_ID = "term-1";

const TrimmedNonEmptyStringSchema = TrimmedNonEmptyString;
const TerminalColsSchema = Schema.Int.check(Schema.isGreaterThanOrEqualTo(1)).check(
  Schema.isLessThanOrEqualTo(1000),
);
const TerminalRowsSchema = Schema.Int.check(Schema.isGreaterThanOrEqualTo(1)).check(
  Schema.isLessThanOrEqualTo(500),
);
const TerminalIdSchema = TrimmedNonEmptyStringSchema.check(Schema.isMaxLength(128));
const TerminalEnvKeySchema = Schema.String.check(
  Schema.isPattern(/^[A-Za-z_][A-Za-z0-9_]*$/),
).check(Schema.isMaxLength(128));
const TerminalEnvValueSchema = Schema.String.check(Schema.isMaxLength(8_192));
const TerminalEnvSchema = Schema.Record(TerminalEnvKeySchema, TerminalEnvValueSchema).check(
  Schema.isMaxProperties(128),
);

export const TerminalThreadInput = Schema.Struct({
  /** @deprecated Terminal ownership is Workspace-scoped. Kept for old clients. */
  threadId: TrimmedNonEmptyString,
});
export type TerminalThreadInput = typeof TerminalThreadInput.Type;

/** Exactly one owner is required on every terminal wire value. */
const terminalOwnerFilter = Schema.makeFilter((input: unknown) => {
  if (input === null || typeof input !== "object") {
    return "Exactly one of workspaceId or threadId is required.";
  }
  const owner = input as {
    readonly workspaceId?: string | undefined;
    readonly threadId?: string | undefined;
  };
  return owner.workspaceId !== undefined && owner.threadId === undefined
    ? true
    : owner.workspaceId === undefined && owner.threadId !== undefined
      ? true
      : "Exactly one of workspaceId or threadId is required.";
});

const TerminalOwnerInput = Schema.Struct({
  workspaceId: Schema.optional(TrimmedNonEmptyStringSchema),
  /** @deprecated Use workspaceId. */
  threadId: Schema.optional(TrimmedNonEmptyStringSchema),
}).check(terminalOwnerFilter);

/**
 * Terminal ids are ALWAYS chosen by the client and sent explicitly — no
 * server-side allocation. New callers send `workspaceId`; `threadId` is an
 * old-client compatibility owner and is not used by the ACode path.
 */
const TerminalSessionInput = Schema.Struct({
  ...TerminalOwnerInput.fields,
  terminalId: TerminalIdSchema,
}).check(terminalOwnerFilter);
export type TerminalSessionInput = Schema.Codec.Encoded<typeof TerminalSessionInput>;

export const TerminalOpenInput = Schema.Struct({
  ...TerminalSessionInput.fields,
  /** Resolved from workspaceId for Workspace-owned sessions. */
  cwd: Schema.optional(TrimmedNonEmptyStringSchema),
  worktreePath: Schema.optional(Schema.NullOr(TrimmedNonEmptyStringSchema)),
  cols: Schema.optional(TerminalColsSchema),
  rows: Schema.optional(TerminalRowsSchema),
  env: Schema.optional(TerminalEnvSchema),
  providerInstanceId: Schema.optional(ProviderInstanceId),
}).check(terminalOwnerFilter);
export type TerminalOpenInput = typeof TerminalOpenInput.Type;

export const TerminalAttachInput = Schema.Struct({
  ...TerminalSessionInput.fields,
  cwd: Schema.optional(TrimmedNonEmptyStringSchema),
  worktreePath: Schema.optional(Schema.NullOr(TrimmedNonEmptyStringSchema)),
  cols: Schema.optional(TerminalColsSchema),
  rows: Schema.optional(TerminalRowsSchema),
  env: Schema.optional(TerminalEnvSchema),
  providerInstanceId: Schema.optional(ProviderInstanceId),
  restartIfNotRunning: Schema.optional(Schema.Boolean),
}).check(terminalOwnerFilter);
export type TerminalAttachInput = typeof TerminalAttachInput.Type;

export const TerminalWriteInput = Schema.Struct({
  ...TerminalSessionInput.fields,
  data: Schema.String.check(Schema.isNonEmpty()).check(Schema.isMaxLength(65_536)),
}).check(terminalOwnerFilter);
export type TerminalWriteInput = Schema.Codec.Encoded<typeof TerminalWriteInput>;

export const TerminalResizeInput = Schema.Struct({
  ...TerminalSessionInput.fields,
  cols: TerminalColsSchema,
  rows: TerminalRowsSchema,
}).check(terminalOwnerFilter);
export type TerminalResizeInput = Schema.Codec.Encoded<typeof TerminalResizeInput>;

export const TerminalClearInput = TerminalSessionInput;
export type TerminalClearInput = Schema.Codec.Encoded<typeof TerminalClearInput>;

export const TerminalRestartInput = Schema.Struct({
  ...TerminalSessionInput.fields,
  /** Resolved from workspaceId for Workspace-owned sessions. */
  cwd: Schema.optional(TrimmedNonEmptyStringSchema),
  worktreePath: Schema.optional(Schema.NullOr(TrimmedNonEmptyStringSchema)),
  cols: TerminalColsSchema,
  rows: TerminalRowsSchema,
  env: Schema.optional(TerminalEnvSchema),
  providerInstanceId: Schema.optional(ProviderInstanceId),
}).check(terminalOwnerFilter);
export type TerminalRestartInput = typeof TerminalRestartInput.Type;

export const TerminalCloseInput = Schema.Struct({
  ...TerminalOwnerInput.fields,
  terminalId: Schema.optional(TerminalIdSchema),
  deleteHistory: Schema.optional(Schema.Boolean),
}).check(terminalOwnerFilter);
export type TerminalCloseInput = typeof TerminalCloseInput.Type;

export const TerminalSessionStatus = Schema.Literals(["starting", "running", "exited", "error", "closed"]);
export type TerminalSessionStatus = typeof TerminalSessionStatus.Type;

export const TerminalSessionSnapshot = Schema.Struct({
  workspaceId: Schema.optional(TrimmedNonEmptyStringSchema),
  /** @deprecated Use workspaceId. */
  threadId: Schema.optional(TrimmedNonEmptyStringSchema),
  terminalId: Schema.String.check(Schema.isNonEmpty()),
  kind: Schema.optional(Schema.Literal("terminal")),
  sessionId: Schema.optional(TerminalSessionId),
  createdAt: Schema.optional(Schema.String),
  cwd: Schema.String.check(Schema.isNonEmpty()),
  worktreePath: Schema.NullOr(TrimmedNonEmptyStringSchema),
  status: TerminalSessionStatus,
  pid: Schema.NullOr(Schema.Int.check(Schema.isGreaterThan(0))),
  history: Schema.String,
  exitCode: Schema.NullOr(Schema.Int),
  exitSignal: Schema.NullOr(Schema.Int),
  /** Server-computed display title (idle shell vs subprocess command). */
  label: Schema.String.check(Schema.isMaxLength(128)),
  updatedAt: Schema.String,
  sequence: Schema.optional(Schema.Int.check(Schema.isGreaterThanOrEqualTo(0))),
  /** Increments whenever a new PTY is spawned for this Session. */
  generation: Schema.optional(Schema.Int.check(Schema.isGreaterThanOrEqualTo(1))),
});
export type TerminalSessionSnapshot = typeof TerminalSessionSnapshot.Type;

export const TerminalSummary = Schema.Struct({
  workspaceId: Schema.optional(TrimmedNonEmptyStringSchema),
  /** @deprecated Use workspaceId. */
  threadId: Schema.optional(TrimmedNonEmptyStringSchema),
  terminalId: Schema.String.check(Schema.isNonEmpty()),
  kind: Schema.optional(SessionKind),
  sessionId: Schema.optional(TerminalSessionId),
  createdAt: Schema.optional(Schema.String),
  cwd: Schema.String.check(Schema.isNonEmpty()),
  worktreePath: Schema.NullOr(TrimmedNonEmptyStringSchema),
  status: TerminalSessionStatus,
  pid: Schema.NullOr(Schema.Int.check(Schema.isGreaterThan(0))),
  exitCode: Schema.NullOr(Schema.Int),
  exitSignal: Schema.NullOr(Schema.Int),
  hasRunningSubprocess: Schema.Boolean,
  /** Server-computed display title (idle shell vs subprocess command). */
  label: Schema.String.check(Schema.isMaxLength(128)),
  updatedAt: Schema.String,
  /** Increments whenever a new PTY is spawned for this Session. */
  generation: Schema.optional(Schema.Int.check(Schema.isGreaterThanOrEqualTo(1))),
});
export type TerminalSummary = typeof TerminalSummary.Type;

const TerminalMetadataSnapshotEvent = Schema.Struct({
  type: Schema.Literal("snapshot"),
  terminals: Schema.Array(TerminalSummary),
});

const TerminalMetadataUpsertEvent = Schema.Struct({
  type: Schema.Literal("upsert"),
  terminal: TerminalSummary,
});

const TerminalMetadataRemoveEvent = Schema.Struct({
  type: Schema.Literal("remove"),
  ...TerminalOwnerInput.fields,
  terminalId: Schema.String.check(Schema.isNonEmpty()),
}).check(terminalOwnerFilter);

export const TerminalMetadataStreamEvent = Schema.Union([
  TerminalMetadataSnapshotEvent,
  TerminalMetadataUpsertEvent,
  TerminalMetadataRemoveEvent,
]);
export type TerminalMetadataStreamEvent = typeof TerminalMetadataStreamEvent.Type;

const TerminalEventBaseSchema = Schema.Struct({
  ...TerminalOwnerInput.fields,
  terminalId: Schema.String.check(Schema.isNonEmpty()),
  sequence: Schema.optional(Schema.Int.check(Schema.isGreaterThanOrEqualTo(0))),
}).check(terminalOwnerFilter);

const TerminalStartedEvent = Schema.Struct({
  ...TerminalEventBaseSchema.fields,
  type: Schema.Literal("started"),
  snapshot: TerminalSessionSnapshot,
});

const TerminalOutputEvent = Schema.Struct({
  ...TerminalEventBaseSchema.fields,
  type: Schema.Literal("output"),
  data: Schema.String,
});

const TerminalExitedEvent = Schema.Struct({
  ...TerminalEventBaseSchema.fields,
  type: Schema.Literal("exited"),
  exitCode: Schema.NullOr(Schema.Int),
  exitSignal: Schema.NullOr(Schema.Int),
});

const TerminalClosedEvent = Schema.Struct({
  ...TerminalEventBaseSchema.fields,
  type: Schema.Literal("closed"),
});

const TerminalErrorEvent = Schema.Struct({
  ...TerminalEventBaseSchema.fields,
  type: Schema.Literal("error"),
  message: Schema.String.check(Schema.isNonEmpty()),
});

const TerminalClearedEvent = Schema.Struct({
  ...TerminalEventBaseSchema.fields,
  type: Schema.Literal("cleared"),
});

const TerminalRestartedEvent = Schema.Struct({
  ...TerminalEventBaseSchema.fields,
  type: Schema.Literal("restarted"),
  snapshot: TerminalSessionSnapshot,
});

const TerminalActivityEvent = Schema.Struct({
  ...TerminalEventBaseSchema.fields,
  type: Schema.Literal("activity"),
  hasRunningSubprocess: Schema.Boolean,
  label: Schema.String.check(Schema.isMaxLength(128)),
});

export const TerminalEvent = Schema.Union([
  TerminalStartedEvent,
  TerminalOutputEvent,
  TerminalExitedEvent,
  TerminalClosedEvent,
  TerminalErrorEvent,
  TerminalClearedEvent,
  TerminalRestartedEvent,
  TerminalActivityEvent,
]);
export type TerminalEvent = typeof TerminalEvent.Type;

const TerminalAttachSnapshotEvent = Schema.Struct({
  type: Schema.Literal("snapshot"),
  snapshot: TerminalSessionSnapshot,
});

export const TerminalAttachStreamEvent = Schema.Union([
  TerminalAttachSnapshotEvent,
  TerminalOutputEvent,
  TerminalExitedEvent,
  TerminalClosedEvent,
  TerminalErrorEvent,
  TerminalClearedEvent,
  TerminalRestartedEvent,
  TerminalActivityEvent,
]);
export type TerminalAttachStreamEvent = typeof TerminalAttachStreamEvent.Type;

export class TerminalCwdNotFoundError extends Schema.TaggedError<TerminalCwdNotFoundError>()(
  "TerminalCwdNotFoundError",
  {
    cwd: Schema.String,
  },
) {
  override get message() {
    return `Terminal cwd does not exist: ${this.cwd}`;
  }
}

export class TerminalCwdNotDirectoryError extends Schema.TaggedError<TerminalCwdNotDirectoryError>()(
  "TerminalCwdNotDirectoryError",
  {
    cwd: Schema.String,
  },
) {
  override get message() {
    return `Terminal cwd is not a directory: ${this.cwd}`;
  }
}

export class TerminalCwdStatError extends Schema.TaggedError<TerminalCwdStatError>()(
  "TerminalCwdStatError",
  {
    cwd: Schema.String,
    cause: Schema.Defect(),
  },
) {
  override get message() {
    return `Failed to access terminal cwd: ${this.cwd}`;
  }
}

export const TerminalCwdError = Schema.Union([
  TerminalCwdNotFoundError,
  TerminalCwdNotDirectoryError,
  TerminalCwdStatError,
]);
export type TerminalCwdError = typeof TerminalCwdError.Type;

export class TerminalHistoryError extends Schema.TaggedError<TerminalHistoryError>()(
  "TerminalHistoryError",
  {
    operation: Schema.Literals(["read", "truncate", "migrate"]),
    workspaceId: Schema.optional(TrimmedNonEmptyStringSchema),
    /** @deprecated Use workspaceId. */
    threadId: Schema.optional(TrimmedNonEmptyStringSchema),
    terminalId: Schema.String,
    cause: Schema.optional(Schema.Defect()),
  },
) {
  override get message() {
    const owner = this.workspaceId
      ? `workspace: ${this.workspaceId}`
      : `thread: ${this.threadId ?? "unknown"}`;
    return `Failed to ${this.operation} terminal history for ${owner}, terminal: ${this.terminalId}`;
  }
}

export class TerminalWorkspaceNotFoundError extends Schema.TaggedError<TerminalWorkspaceNotFoundError>()(
  "TerminalWorkspaceNotFoundError",
  {
    workspaceId: TrimmedNonEmptyStringSchema,
  },
) {
  override get message() {
    return `Unknown terminal workspace: ${this.workspaceId}`;
  }
}

/**
 * The daemon has no workspace-root resolver wired, so workspace-owned
 * terminals cannot be opened at all. Distinct from
 * `TerminalWorkspaceNotFoundError`: the workspace may exist — the daemon
 * itself is degraded.
 */
export class TerminalWorkspaceResolutionUnavailableError extends Schema.TaggedError<TerminalWorkspaceResolutionUnavailableError>()(
  "TerminalWorkspaceResolutionUnavailableError",
  {
    workspaceId: TrimmedNonEmptyStringSchema,
  },
) {
  override get message() {
    return `Terminal workspace resolution is unavailable for workspace: ${this.workspaceId}`;
  }
}

export class TerminalSessionLookupError extends Schema.TaggedError<TerminalSessionLookupError>()(
  "TerminalSessionLookupError",
  {
    workspaceId: Schema.optional(TrimmedNonEmptyStringSchema),
    /** @deprecated Use workspaceId. */
    threadId: Schema.optional(TrimmedNonEmptyStringSchema),
    terminalId: Schema.String,
  },
) {
  override get message() {
    const owner = this.workspaceId
      ? `workspace: ${this.workspaceId}`
      : `thread: ${this.threadId ?? "unknown"}`;
    return `Unknown terminal ${owner}, terminal: ${this.terminalId}`;
  }
}

export class TerminalProviderInstanceNotFoundError extends Schema.TaggedError<TerminalProviderInstanceNotFoundError>()(
  "TerminalProviderInstanceNotFoundError",
  {
    providerInstanceId: ProviderInstanceId,
  },
) {
  override get message() {
    return `Provider instance is not available: ${this.providerInstanceId}`;
  }
}

export class TerminalProviderEnvironmentError extends Schema.TaggedError<TerminalProviderEnvironmentError>()(
  "TerminalProviderEnvironmentError",
  {
    providerInstanceId: ProviderInstanceId,
    cause: Schema.Defect(),
  },
) {
  override get message() {
    return `Could not prepare the terminal environment for provider instance: ${this.providerInstanceId}`;
  }
}

export class TerminalNotRunningError extends Schema.TaggedError<TerminalNotRunningError>()(
  "TerminalNotRunningError",
  {
    workspaceId: Schema.optional(TrimmedNonEmptyStringSchema),
    /** @deprecated Use workspaceId. */
    threadId: Schema.optional(TrimmedNonEmptyStringSchema),
    terminalId: Schema.String,
  },
) {
  override get message() {
    const owner = this.workspaceId
      ? `workspace: ${this.workspaceId}`
      : `thread: ${this.threadId ?? "unknown"}`;
    return `Terminal is not running for ${owner}, terminal: ${this.terminalId}`;
  }
}

export class TerminalWriteError extends Schema.TaggedError<TerminalWriteError>()(
  "TerminalWriteError",
  {
    workspaceId: Schema.optional(TrimmedNonEmptyStringSchema),
    /** @deprecated Use workspaceId. */
    threadId: Schema.optional(TrimmedNonEmptyStringSchema),
    terminalId: Schema.String,
    terminalPid: Schema.Number,
    cause: Schema.Defect(),
  },
) {
  override get message() {
    const owner = this.workspaceId
      ? `workspace: ${this.workspaceId}`
      : `thread: ${this.threadId ?? "unknown"}`;
    return `Failed to write to terminal for ${owner}, terminal: ${this.terminalId}, PID: ${this.terminalPid}`;
  }
}

export class TerminalResizeError extends Schema.TaggedError<TerminalResizeError>()(
  "TerminalResizeError",
  {
    workspaceId: Schema.optional(TrimmedNonEmptyStringSchema),
    /** @deprecated Use workspaceId. */
    threadId: Schema.optional(TrimmedNonEmptyStringSchema),
    terminalId: Schema.String,
    terminalPid: Schema.Number,
    cols: TerminalColsSchema,
    rows: TerminalRowsSchema,
    cause: Schema.Defect(),
  },
) {
  override get message() {
    const owner = this.workspaceId
      ? `workspace: ${this.workspaceId}`
      : `thread: ${this.threadId ?? "unknown"}`;
    return `Failed to resize terminal for ${owner}, terminal: ${this.terminalId}, PID: ${this.terminalPid} to ${this.cols}x${this.rows}`;
  }
}

export const TerminalError = Schema.Union([
  TerminalCwdError,
  TerminalHistoryError,
  TerminalWorkspaceNotFoundError,
  TerminalWorkspaceResolutionUnavailableError,
  TerminalSessionLookupError,
  TerminalProviderInstanceNotFoundError,
  TerminalProviderEnvironmentError,
  TerminalNotRunningError,
  TerminalWriteError,
  TerminalResizeError,
]);
export type TerminalError = typeof TerminalError.Type;
