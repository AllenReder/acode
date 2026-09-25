import { isProviderDriverKind, ProviderDriverKind, type TerminalSummary } from "@awen/contracts";
import type { ComponentType } from "react";
import { SparklesIcon, TerminalIcon } from "lucide-react";
import { PROVIDER_ICON_BY_PROVIDER } from "../chat/providerIconUtils";
import type { SessionStatusAlert } from "./SessionRow";

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

export function resolveAgentSessionStatusAlert(
  threadShell:
    | {
        readonly hasPendingApprovals?: boolean;
        readonly hasPendingUserInput?: boolean;
        readonly latestTurn?: { readonly state: string } | null;
      }
    | null
    | undefined,
  options?: { readonly isFocused?: boolean },
): SessionStatusAlert {
  if (!threadShell) return "idle";
  if (threadShell.hasPendingApprovals || threadShell.hasPendingUserInput) {
    return "action-required";
  }
  if (threadShell.latestTurn?.state === "error") {
    return "error";
  }
  if (threadShell.latestTurn?.state === "running") {
    return "running";
  }
  if (options?.isFocused === false && threadShell.latestTurn?.state === "completed") {
    return "completed-unread";
  }
  return "idle";
}

export function resolveTerminalSessionStatusAlert(
  summary:
    | Pick<TerminalSummary, "hasRunningSubprocess" | "status">
    | {
        readonly hasRunningSubprocess?: boolean;
        readonly status?: string;
        readonly exitCode?: number | null;
      }
    | null
    | undefined,
): SessionStatusAlert {
  if (!summary) return "idle";
  if (
    summary.status === "error" ||
    ("exitCode" in summary && summary.exitCode !== null && summary.exitCode !== undefined && summary.exitCode !== 0)
  ) {
    return "error";
  }
  if (summary.hasRunningSubprocess) {
    return "running";
  }
  return "idle";
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
