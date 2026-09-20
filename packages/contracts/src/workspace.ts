import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";

import {
  AgentSessionId,
  AcodeProjectId,
  EventId,
  ForwardCompatibleArray,
  IsoDateTime,
  ProjectId,
  TerminalSessionId,
  ThreadId,
  TrimmedNonEmptyString,
  WorkspaceId,
} from "./baseSchemas.ts";

/**
 * Where the checkout sits in the Project's repository. "main" is the
 * registered root checkout; "worktree" is an associated or ACode-created
 * linked worktree. Display state (branch, commit, detached HEAD) never feeds
 * this value.
 */
export const WorkspaceRole = Schema.Literals(["main", "worktree"]);
export type WorkspaceRole = typeof WorkspaceRole.Type;

/**
 * How a "worktree" Workspace came to exist. ACode only deletes directories it
 * created, so the delete-directory action is gated on "acode-created".
 * Absent on "main" Workspaces and on shells from servers predating the field.
 */
export const WorkspaceOrigin = Schema.Literals(["associated", "acode-created"]);
export type WorkspaceOrigin = typeof WorkspaceOrigin.Type;

/**
 * A durable ACode Session shell: the fields every Session kind exposes in the
 * Workspace projection. The kind discriminates the identity, and the runtime
 * binding for that kind stays on its own shell variant.
 */
export const AcodeSessionLifecycleStatus = Schema.Literals(["open", "closed"]);
export type AcodeSessionLifecycleStatus = typeof AcodeSessionLifecycleStatus.Type;

const AcodeSessionShellFields = {
  workspaceId: WorkspaceId,
  title: TrimmedNonEmptyString,
  status: Schema.optional(AcodeSessionLifecycleStatus).pipe(
    Schema.withDecodingDefault(Effect.succeed("open" as const)),
  ),
  closedAt: Schema.optional(Schema.NullOr(IsoDateTime)),
  createdAt: IsoDateTime,
  updatedAt: IsoDateTime,
};

/** The durable ACode identity and T3 conversation binding shown in a Workspace. */
export const AcodeAgentSessionShell = Schema.Struct({
  /**
   * Agent was the only Session kind before the shared contract, so shells from
   * a server that predates this discriminant decode as Agent instead of
   * failing the whole snapshot. New encodings always carry the key.
   */
  kind: Schema.Literal("agent").pipe(Schema.withDecodingDefault(Effect.succeed("agent"))),
  id: AgentSessionId,
  ...AcodeSessionShellFields,
  threadId: ThreadId,
});
export type AcodeAgentSessionShell = typeof AcodeAgentSessionShell.Type;

/**
 * A durable ACode Terminal Session shell. Its identity is independent of the
 * PTY process currently backing it; the runtime terminal id stays behind the
 * Terminal Session adapter.
 */
export const AcodeTerminalSessionShell = Schema.Struct({
  kind: Schema.Literal("terminal"),
  id: TerminalSessionId,
  ...AcodeSessionShellFields,
});
export type AcodeTerminalSessionShell = typeof AcodeTerminalSessionShell.Type;

/** The shared durable Session contract projected under a Workspace. */
export const AcodeSessionShell = Schema.Union([AcodeAgentSessionShell, AcodeTerminalSessionShell]);
export type AcodeSessionShell = typeof AcodeSessionShell.Type;

/** Narrow a projected Session shell to the Agent kind. */
const isAcodeAgentSessionShell = Schema.is(AcodeAgentSessionShell);

/**
 * The Agent Session shells of one Workspace projection.
 *
 * Operates on *decoded* shells. `Schema.is` does not honour the Agent shell's
 * `kind` decoding default, so a raw pre-discriminant payload that never went
 * through `AcodeProjectShell` decoding is not recognized and yields no Agent
 * Sessions. Every caller reads its Workspace from a decoded snapshot.
 */
export function agentSessionsIn(workspace: {
  readonly sessions?: ReadonlyArray<AcodeSessionShell> | undefined;
  readonly historySessions?: ReadonlyArray<AcodeSessionShell> | undefined;
}): ReadonlyArray<AcodeAgentSessionShell> {
  return [...(workspace.sessions ?? []), ...(workspace.historySessions ?? [])].filter(
    isAcodeAgentSessionShell,
  );
}

export function activeAgentSessionsIn(workspace: {
  readonly sessions?: ReadonlyArray<AcodeSessionShell> | undefined;
}): ReadonlyArray<AcodeAgentSessionShell> {
  return (workspace.sessions ?? []).filter(isAcodeAgentSessionShell);
}

export function historyAgentSessionsIn(workspace: {
  readonly historySessions?: ReadonlyArray<AcodeSessionShell> | undefined;
}): ReadonlyArray<AcodeAgentSessionShell> {
  return (workspace.historySessions ?? []).filter(isAcodeAgentSessionShell);
}

/** A stable checkout owned by one ACode Project. */
export const AcodeWorkspaceShell = Schema.Struct({
  id: WorkspaceId,
  projectId: AcodeProjectId,
  /** The T3 orchestration project that owns the execution directory. */
  t3ProjectId: ProjectId,
  title: TrimmedNonEmptyString,
  workspaceRoot: TrimmedNonEmptyString,
  role: WorkspaceRole,
  /** Only set for "worktree" Workspaces; absent on "main". */
  origin: Schema.optional(WorkspaceOrigin),
  /**
   * Sessions of every kind. Decoded with `ForwardCompatibleArray` so a server
   * that adds a Session kind this build does not know drops that one element
   * instead of failing the whole Workspace snapshot. The transcript and
   * execution state remain on the T3 thread shell.
   */
  sessions: Schema.optional(ForwardCompatibleArray(AcodeSessionShell)),
  historySessions: Schema.optional(ForwardCompatibleArray(AcodeSessionShell)),
  createdAt: IsoDateTime,
  updatedAt: IsoDateTime,
});
export type AcodeWorkspaceShell = typeof AcodeWorkspaceShell.Type;

/** A navigation Project grouping one or more ACode Workspaces. */
export const AcodeProjectShell = Schema.Struct({
  id: AcodeProjectId,
  title: TrimmedNonEmptyString,
  workspaces: Schema.Array(AcodeWorkspaceShell),
  createdAt: IsoDateTime,
  updatedAt: IsoDateTime,
});
export type AcodeProjectShell = typeof AcodeProjectShell.Type;

/**
 * Stable fallback identities for legacy project.create callers. The mapping
 * is deterministic but still keeps the ACode and T3 identifiers distinct.
 */
export function acodeProjectIdForT3Project(projectId: ProjectId): AcodeProjectId {
  return AcodeProjectId.make(`acode-project:${projectId}`);
}

export function workspaceIdForT3Project(projectId: ProjectId): WorkspaceId {
  return WorkspaceId.make(`workspace:${projectId}`);
}

/** Stable ACode identity derived from the creation event, not the thread id. */
export function agentSessionIdForThreadCreatedEvent(eventId: EventId): AgentSessionId {
  return AgentSessionId.make(`agent-session:${eventId}`);
}

// --- Workspace management RPC (acodeWorkspace.*) ---

/** Attach an existing on-disk checkout as a sibling Workspace of the Project. */
export const AcodeWorkspaceAssociateInput = Schema.Struct({
  projectId: AcodeProjectId,
  /** Directory of the checkout to associate. Subdirectories resolve to the checkout root. */
  path: TrimmedNonEmptyString,
  title: Schema.optional(TrimmedNonEmptyString),
});
export type AcodeWorkspaceAssociateInput = typeof AcodeWorkspaceAssociateInput.Type;

export const AcodeWorkspaceAssociateResult = Schema.Struct({
  workspace: AcodeWorkspaceShell,
  /** True when the checkout was already registered under this Project and nothing changed. */
  reused: Schema.Boolean,
});
export type AcodeWorkspaceAssociateResult = typeof AcodeWorkspaceAssociateResult.Type;

/** Create a Git worktree from the Project's repository and register it as a Workspace. */
export const AcodeWorkspaceCreateWorktreeInput = Schema.Struct({
  projectId: AcodeProjectId,
  /** Create and check out this new branch. Omit to detach at `baseRef`. */
  newBranch: Schema.optional(TrimmedNonEmptyString),
  /** Branch, tag, or commit the worktree starts from. Defaults to HEAD. */
  baseRef: Schema.optional(TrimmedNonEmptyString),
  /** Explicit destination directory. Defaults to the daemon-managed worktrees directory. */
  path: Schema.optional(TrimmedNonEmptyString),
  title: Schema.optional(TrimmedNonEmptyString),
});
export type AcodeWorkspaceCreateWorktreeInput = typeof AcodeWorkspaceCreateWorktreeInput.Type;

export const AcodeWorkspaceCreateWorktreeResult = Schema.Struct({
  workspace: AcodeWorkspaceShell,
  worktreePath: TrimmedNonEmptyString,
  /**
   * False when the directory already held a completed worktree of the same
   * repository, so a retried request registers it instead of failing.
   */
  worktreeCreated: Schema.Boolean,
});
export type AcodeWorkspaceCreateWorktreeResult = typeof AcodeWorkspaceCreateWorktreeResult.Type;

export const AcodeWorkspaceRemoveInput = Schema.Struct({
  workspaceId: WorkspaceId,
  /**
   * Also delete the directory from disk. Only honored for "worktree"
   * Workspaces with origin "acode-created"; the main checkout is never
   * deleted through this action.
   */
  deleteDirectory: Schema.optional(Schema.Boolean),
});
export type AcodeWorkspaceRemoveInput = typeof AcodeWorkspaceRemoveInput.Type;

export const AcodeWorkspaceRemoveResult = Schema.Struct({
  /** False when the Workspace was already unregistered; removal is idempotent. */
  removed: Schema.Boolean,
  deletedDirectory: Schema.Boolean,
  /** Present when registration was removed but the requested directory cleanup was not. */
  warning: Schema.optional(TrimmedNonEmptyString),
});
export type AcodeWorkspaceRemoveResult = typeof AcodeWorkspaceRemoveResult.Type;

export const AcodeWorkspaceRenameInput = Schema.Struct({
  workspaceId: WorkspaceId,
  title: TrimmedNonEmptyString,
});
export type AcodeWorkspaceRenameInput = typeof AcodeWorkspaceRenameInput.Type;

export const AcodeWorkspaceRenameResult = Schema.Struct({
  workspace: AcodeWorkspaceShell,
});
export type AcodeWorkspaceRenameResult = typeof AcodeWorkspaceRenameResult.Type;

export const AcodeWorkspaceErrorReason = Schema.Literals([
  /** The target ACode Project does not exist (or has no checkout to anchor on). */
  "project-not-found",
  /** The associate path does not exist or is not a directory. */
  "path-not-found",
  /** The associate path is not inside a Git working tree. */
  "not-a-repository",
  /** The checkout belongs to a different repository than the Project. */
  "different-repository",
  /** The checkout is already registered under another Project. */
  "already-registered",
  /** The target path exists, is reserved, or nests inside a registered checkout. */
  "path-conflict",
  /** The requested new branch name is invalid or already exists. */
  "branch-exists",
  /** The base ref does not resolve to a commit. */
  "invalid-ref",
  /** Directory deletion was requested for the main checkout. */
  "main-checkout-protected",
  /** Directory deletion was requested for a checkout ACode did not create. */
  "not-acode-created",
  /** Directory deletion was refused because the worktree has uncommitted or untracked files. */
  "dirty-worktree",
  /** Registration removal was refused because the Workspace still owns Sessions. */
  "workspace-not-empty",
  /** The requested Workspace identity does not exist on this server. */
  "workspace-not-found",
  /** The underlying Git operation failed; the directory state is unchanged. */
  "git-failed",
  /** The worktree was created on disk but Workspace registration failed. The directory was kept. */
  "registration-failed",
]);
export type AcodeWorkspaceErrorReason = typeof AcodeWorkspaceErrorReason.Type;

export class AcodeWorkspaceError extends Schema.TaggedError<AcodeWorkspaceError>()(
  "AcodeWorkspaceError",
  {
    reason: AcodeWorkspaceErrorReason,
    detail: Schema.String,
    /** The on-disk path involved, when one exists (e.g. the kept worktree after a registration failure). */
    path: Schema.optional(Schema.String),
    cause: Schema.optional(Schema.Defect()),
  },
) {
  override get message(): string {
    return this.detail;
  }
}
