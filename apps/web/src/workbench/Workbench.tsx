import { useEffect, useMemo, useRef } from "react";
import { useParams } from "@tanstack/react-router";

import { activeAgentSessionsIn, type EnvironmentId, type ThreadId } from "@t3tools/contracts";

import { useAcodeProjects } from "../state/entities";
import { PaneTree } from "./PaneTree";
import { urlParamsToTarget } from "./urlBridge";
import { targetKey, type ViewTarget } from "./viewRegistry";
import "./viewDefinitions";
import { useWorkbenchStore } from "./workbenchStore";

/**
 * The workbench shell. Mounted once per route that should display Pane
 * content (`_chat` in C10; settings/welcome/etc. render their own children).
 *
 * Responsibilities:
 *   - subscribes to the workbench store,
 *   - reads the current URL and resolves it to a `ViewTarget`,
 *   - dispatches the target to `openTarget` whenever the URL changes,
 *   - renders the `PaneTree` for the current snapshot.
 *
 * Closing a Pane and reopening it from the Sidebar re-binds the same
 * underlying Agent/Terminal Session — there is no nested SPA entry for
 * `ThreadRouteView` (per the C10 acceptance line: "one workbench on launch,
 * no nested SPAs").
 */
export function Workbench() {
  const snapshot = useWorkbenchStore();
  const openTarget = useWorkbenchStore((s) => s.openTarget);
  const projects = useAcodeProjects();

  const params = useParams({ strict: false }) as {
    environmentId?: string;
    threadId?: string;
    draftId?: string;
  };

  const { environmentId, threadId } = resolveUrlInputs(params);
  const lastUrlRef = useRef<string | null>(null);

  // Observe transitions from active to closed/deleted to clean up views across tabs
  const activeSessionTargetsRef = useRef<Map<string, ViewTarget>>(new Map());
  useEffect(() => {
    const nextActiveTargets = new Map<string, ViewTarget>();
    for (const project of projects) {
      for (const workspace of project.workspaces) {
        for (const session of activeAgentSessionsIn(workspace)) {
          const target: ViewTarget = {
            kind: "agentSession",
            environmentId: project.environmentId,
            workspaceId: workspace.id,
            agentSessionId: session.id,
          };
          nextActiveTargets.set(targetKey(target), target);
        }
        for (const session of (workspace.sessions ?? []).filter((s) => s.kind === "terminal")) {
          const target: ViewTarget = {
            kind: "workspaceTerminal",
            environmentId: project.environmentId,
            workspaceId: workspace.id,
            terminalSessionId: session.id,
          };
          nextActiveTargets.set(targetKey(target), target);
        }
      }
    }

    const previous = activeSessionTargetsRef.current;
    if (previous.size > 0) {
      for (const [key, target] of previous) {
        if (!nextActiveTargets.has(key)) {
          useWorkbenchStore.getState().removeSessionViews(target);
        }
      }
    }
    activeSessionTargetsRef.current = nextActiveTargets;
  }, [projects]);

  useEffect(() => {
    const urlKey = `${environmentId ?? ""}::${threadId ?? ""}`;
    if (lastUrlRef.current === urlKey) return;
    lastUrlRef.current = urlKey;
    const target = urlParamsToTarget(environmentId, threadId, projects);
    if (target !== null) {
      openTarget(target);
    }
  }, [environmentId, threadId, projects, openTarget]);

  return <PaneTree snapshot={snapshot} />;
}

function resolveUrlInputs(params: {
  environmentId?: string;
  threadId?: string;
  draftId?: string;
}): { environmentId: EnvironmentId | null; threadId: ThreadId | null } {
  if (params.draftId !== undefined) {
    // Drafts are retired in C10 (per the issue body). A draft URL falls
    // through to no target; the workbench stays on its current Pane.
    return { environmentId: null, threadId: null };
  }
  if (params.environmentId === undefined || params.threadId === undefined) {
    return { environmentId: null, threadId: null };
  }
  return {
    environmentId: params.environmentId as EnvironmentId,
    threadId: params.threadId as ThreadId,
  };
}

// suppress unused warning on `useMemo` until tests consume it
void useMemo;
