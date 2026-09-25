import {
  isProviderDriverKind,
  ProviderDriverKind,
  type TerminalSessionStatus,
} from "@awen/contracts";
import type { ComponentType } from "react";
import { SparklesIcon, TerminalIcon } from "lucide-react";
import { PROVIDER_ICON_BY_PROVIDER } from "../chat/providerIconUtils";
import { isLatestTurnSettled } from "../../session-logic";
import type { SidebarThreadSummary } from "../../types";

/**
 * The current activity, blockage, or failure of a Session, independent of
 * Sidebar focus or Workbench Tab presence. Agent and Terminal sessions share
 * this vocabulary; `ready` is the unlabeled resting state. Unread Completion is
 * a separate decoration on `ready`, never an eighth status.
 */
export type SessionStatus =
  | "approval"
  | "input"
  | "plan"
  | "working"
  | "monitoring"
  | "failed"
  | "ready";

export type AgentSessionStatusInput = Pick<
  SidebarThreadSummary,
  | "hasPendingApprovals"
  | "hasPendingUserInput"
  | "hasActionableProposedPlan"
  | "interactionMode"
  | "latestTurn"
  | "session"
  | "backgroundLiveness"
>;

export function detectAgentDriverFromCommand(
  command: string | null | undefined,
): ProviderDriverKind | null {
  if (!command) return null;
  const normalized = command.toLowerCase().trim();
  if (
    normalized === "opencode" ||
    /(?:^|[\\/_-])opencode(?:\.exe|\.cmd|\.js|\.ps1)?$/i.test(normalized)
  ) {
    return ProviderDriverKind.make("opencode");
  }
  if (
    normalized === "claude" ||
    normalized === "claude-code" ||
    /(?:^|[\\/_-])claude(?:-code)?(?:\.exe|\.cmd|\.js|\.ps1)?$/i.test(normalized)
  ) {
    return ProviderDriverKind.make("claudeAgent");
  }
  if (
    normalized === "codex" ||
    /(?:^|[\\/_-])codex(?:\.exe|\.cmd|\.js|\.ps1)?$/i.test(normalized)
  ) {
    return ProviderDriverKind.make("codex");
  }
  if (
    normalized === "cursor" ||
    /(?:^|[\\/_-])cursor(?:\.exe|\.cmd|\.js|\.ps1)?$/i.test(normalized)
  ) {
    return ProviderDriverKind.make("cursor");
  }
  return null;
}

/**
 * Session Status for an Agent session. Priority, highest first: `approval`,
 * `input`, `working` (starting/running), `failed` (session error), `plan`
 * (settled plan turn with an actionable plan, never on an error),
 * `working` (background liveness), `monitoring`, `ready`. Focus is never an
 * input, so looking at a session cannot change what it reports.
 */
export function resolveAgentSessionStatus(
  thread: AgentSessionStatusInput | null | undefined,
): SessionStatus {
  if (!thread) return "ready";
  if (thread.hasPendingApprovals) return "approval";
  if (thread.hasPendingUserInput) return "input";
  const sessionStatus = thread.session?.status;
  if (sessionStatus === "starting" || sessionStatus === "running") return "working";
  if (sessionStatus === "error") return "failed";
  if (thread.session == null && thread.latestTurn?.state === "error") return "failed";
  if (
    thread.interactionMode === "plan" &&
    thread.latestTurn?.state !== "error" &&
    isLatestTurnSettled(thread.latestTurn, thread.session) &&
    thread.hasActionableProposedPlan
  ) {
    return "plan";
  }
  if (thread.backgroundLiveness === "working") return "working";
  if (thread.backgroundLiveness === "monitoring") return "monitoring";
  return "ready";
}

export interface TerminalSessionStatusInput {
  readonly status?: TerminalSessionStatus | null;
  readonly hasRunningSubprocess?: boolean | null;
  readonly exitCode?: number | null;
}

/**
 * Session Status for a Terminal session, from zero-config foreground-process
 * detection: a running subprocess is `working`, an error or non-zero exit is
 * `failed`, and an idle shell is `ready`.
 */
export function resolveTerminalSessionStatus(
  summary: TerminalSessionStatusInput | null | undefined,
): SessionStatus {
  if (!summary) return "ready";
  if (
    summary.status === "error" ||
    (typeof summary.exitCode === "number" && summary.exitCode !== 0)
  ) {
    return "failed";
  }
  if (summary.hasRunningSubprocess) return "working";
  return "ready";
}

export interface UnreadCompletionInput {
  readonly status: SessionStatus;
  readonly latestTurn?:
    | {
        readonly state: string;
        readonly completedAt?: string | null | undefined;
      }
    | null
    | undefined;
  readonly lastVisitedAt?: string | null | undefined;
}

/**
 * Unread Completion: a `ready` Session whose latest turn completed after the
 * Session was last focused. It is a decoration on `ready`, so a failure or live
 * work never reads as unread. A missing or malformed visit marker counts as
 * unread, because a first turn has no marker before it completes.
 */
export function isUnreadCompletion(input: UnreadCompletionInput): boolean {
  if (input.status !== "ready") return false;
  const turn = input.latestTurn;
  if (!turn || turn.state !== "completed" || !turn.completedAt) return false;
  const completedAtMs = Date.parse(turn.completedAt);
  if (Number.isNaN(completedAtMs)) return false;
  if (!input.lastVisitedAt) return true;
  const visitedAtMs = Date.parse(input.lastVisitedAt);
  if (Number.isNaN(visitedAtMs)) return true;
  return completedAtMs > visitedAtMs;
}

export function resolveTerminalIcon(
  summary:
    | {
        readonly hasRunningSubprocess?: boolean;
        readonly label?: string | null;
      }
    | null
    | undefined,
): ComponentType<{ className?: string }> {
  if (summary?.hasRunningSubprocess && summary.label) {
    const driverKind = detectAgentDriverFromCommand(summary.label);
    if (driverKind) {
      const ProviderIcon = PROVIDER_ICON_BY_PROVIDER[driverKind];
      if (ProviderIcon) return ProviderIcon;
    }
  }
  return TerminalIcon;
}

export function resolveAgentIcon(
  driverKindOrInstanceId: string | null | undefined,
): ComponentType<{ className?: string }> {
  if (driverKindOrInstanceId) {
    if (isProviderDriverKind(driverKindOrInstanceId)) {
      const ProviderIcon = PROVIDER_ICON_BY_PROVIDER[driverKindOrInstanceId];
      if (ProviderIcon) return ProviderIcon;
    }
    const detected = detectAgentDriverFromCommand(driverKindOrInstanceId);
    if (detected) {
      const ProviderIcon = PROVIDER_ICON_BY_PROVIDER[detected];
      if (ProviderIcon) return ProviderIcon;
    }
  }
  return SparklesIcon;
}
