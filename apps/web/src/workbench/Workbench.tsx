import { useEffect, useMemo, useRef } from "react";
import { useParams } from "@tanstack/react-router";

import type { EnvironmentId, ThreadId } from "@t3tools/contracts";

import { useAcodeProjects } from "../state/entities";
import { PaneTree } from "./PaneTree";
import { urlParamsToTarget } from "./urlBridge";
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

  useEffect(() => {
    const urlKey = `${environmentId ?? ""}::${threadId ?? ""}`;
    if (lastUrlRef.current === urlKey) return;
    lastUrlRef.current = urlKey;
    const target = urlParamsToTarget(
      environmentId,
      threadId,
      projects,
    );
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