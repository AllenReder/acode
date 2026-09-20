import { scopeThreadRef } from "@t3tools/client-runtime/environment";
import { agentSessionsIn } from "@t3tools/contracts";
import { useNavigate } from "@tanstack/react-router";
import { useEffect, useMemo } from "react";

import ChatView from "../components/ChatView";
import {
  finalizePromotedDraftThreadByRef,
  markPromotedDraftThreadByRef,
  useBackgroundDraftSubmissionPending,
  useComposerDraftStore,
} from "../composerDraftStore";
import { resolveDraftPromotionNavigationTarget } from "../components/ChatView.logic";
import { waitForDraftHeroTransition } from "../components/chat/draftHeroTransition";
import { useAcodeProjects, useThread, useThreadShell } from "../state/entities";
import { AgentView } from "./AgentView";
import { sessionRouteForTarget } from "./deepLinks";
import type { ViewTarget } from "./viewRegistry";
import { useWorkbenchStore } from "./workbenchStore";

type AgentSessionViewTarget = Extract<ViewTarget, { kind: "agentSession" | "newAgentSession" }>;

interface AgentSessionViewProps {
  readonly target: AgentSessionViewTarget;
  readonly paneId: string;
  readonly focused: boolean;
  readonly focusRequestId?: number;
  readonly availableSize: { readonly width: number; readonly height: number };
}

export function AgentSessionView(props: AgentSessionViewProps) {
  return props.target.kind === "newAgentSession" ? (
    <NewAgentSessionView {...props} target={props.target} />
  ) : (
    <AgentView {...props} target={props.target} />
  );
}

/** Present the first-turn draft without assigning it an ACode Session identity. */
export function NewAgentSessionView({
  target,
  paneId,
  focused,
  focusRequestId = 0,
  availableSize,
}: AgentSessionViewProps & {
  readonly target: Extract<ViewTarget, { kind: "newAgentSession" }>;
}) {
  const navigate = useNavigate();
  const replaceTarget = useWorkbenchStore((state) => state.replaceTarget);
  const draft = useComposerDraftStore((state) => state.getDraftSession(target.draftId));
  const projects = useAcodeProjects();
  const draftThreadRef = useMemo(
    () => (draft === null ? null : scopeThreadRef(target.environmentId, draft.threadId)),
    [draft, target.environmentId],
  );
  const draftThread = useComposerDraftStore((state) =>
    draftThreadRef === null ? null : state.getDraftThreadByRef(draftThreadRef),
  );
  const serverThread = useThread(draftThreadRef, { waitForShell: true });
  const serverThreadShell = useThreadShell(draftThreadRef);
  const backgroundSubmissionPending = useBackgroundDraftSubmissionPending(draftThreadRef);
  const canonicalThreadRef =
    draftThreadRef === null || draftThread?.promotedTo
      ? null
      : resolveDraftPromotionNavigationTarget({
          serverThreadRef: draftThreadRef,
          serverThread,
          backgroundSubmissionPending,
        });
  const agentTarget = useMemo(() => {
    if (draftThreadRef === null || draft === null) return null;
    for (const project of projects) {
      if (project.environmentId !== target.environmentId) continue;
      const workspace = project.workspaces.find((candidate) => candidate.id === draft.workspaceId);
      if (workspace === undefined) continue;
      const session = agentSessionsIn(workspace).find(
        (candidate) => candidate.threadId === draftThreadRef.threadId,
      );
      if (session !== undefined) {
        return {
          kind: "agentSession" as const,
          environmentId: target.environmentId,
          workspaceId: draft.workspaceId,
          agentSessionId: session.id,
        };
      }
    }
    return null;
  }, [draft, draftThreadRef, projects, target.environmentId]);

  useEffect(() => {
    if (draftThreadRef === null || serverThreadShell === null || draftThread?.promotedTo) return;
    markPromotedDraftThreadByRef(draftThreadRef);
  }, [draftThread?.promotedTo, draftThreadRef, serverThreadShell]);

  useEffect(() => {
    if (canonicalThreadRef === null || agentTarget === null) return;
    replaceTarget(paneId, agentTarget);
    void waitForDraftHeroTransition().then(() => {
      finalizePromotedDraftThreadByRef(canonicalThreadRef);
      const route = sessionRouteForTarget(agentTarget);
      void navigate({ to: route.to as never, params: route.params, replace: true } as never);
    });
  }, [agentTarget, canonicalThreadRef, navigate, paneId, replaceTarget]);

  if (
    draft === null ||
    draft.environmentId !== target.environmentId ||
    draft.workspaceId !== target.workspaceId
  ) {
    return (
      <div className="flex h-full min-h-0 items-center justify-center p-6 text-sm text-muted-foreground">
        New Agent draft is no longer available.
      </div>
    );
  }

  return (
    <ChatView
      environmentId={target.environmentId}
      threadId={draft.threadId}
      routeKind="draft"
      draftId={target.draftId}
      workbenchMode
      focused={focused}
      focusRequestId={focusRequestId}
      availableSize={availableSize}
    />
  );
}
