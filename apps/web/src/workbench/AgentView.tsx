import ChatView from "../components/ChatView";
import { useAcodeAgentSessionShell } from "../state/entities";
import type { ViewTarget } from "./viewRegistry";

interface AgentViewProps {
  readonly target: Extract<ViewTarget, { kind: "agentSession" }>;
  readonly paneId: string;
  readonly focused: boolean;
  readonly focusRequestId?: number;
  readonly availableSize: { readonly width: number; readonly height: number };
}

/**
 * View definition rendering one ACode Agent Session inside a Pane.
 *
 * Adapter from the workbench's `View instance` to the existing `<ChatView>`
 * component (which already hosts the T3 timeline, composer, tool activity,
 * approvals and error surface). The View passes the Agent Session's owning
 * Workspace and Session ids explicitly — there is no assumption of a single
 * global selected thread (per the C10 issue body).
 *
 * Closing this View (closing the Pane) tears down only ChatView's local
 * subscriptions; the Agent Session's transcript and execution state remain on
 * the daemon, so re-opening the same Session from the Sidebar reattaches to
 * the live Agent Session rather than creating a fresh one.
 */
export function AgentView({ target, focused, focusRequestId = 0, availableSize }: AgentViewProps) {
  const session = useAcodeAgentSessionShell(
    target.environmentId,
    target.workspaceId,
    target.agentSessionId,
  );

  if (session === null) {
    return (
      <div className="flex h-full min-h-0 items-center justify-center p-6 text-sm text-muted-foreground">
        Agent Session is no longer available.
      </div>
    );
  }

  return (
    <ChatView
      environmentId={target.environmentId}
      threadId={session.threadId}
      routeKind="server"
      focused={focused}
      focusRequestId={focusRequestId}
      availableSize={availableSize}
    />
  );
}
