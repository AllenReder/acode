import { useEffect } from "react";
import type { EnvironmentAwenProject } from "@awen/client-runtime/state/models";
import { scopeThreadRef, scopedThreadKey } from "@awen/client-runtime/environment";
import type { ScopedThreadRef } from "@awen/contracts";
import { useComposerDraftStore } from "../composerDraftStore";
import { useAgentSessionLifecycle } from "../hooks/useAgentSessionLifecycle";
import type { ViewTarget } from "./viewRegistry";
import { useWorkbenchStore } from "./workbenchStore";

/** Only explicit Pane/Tab closes trigger cleanup; moves and draft promotion do not. */
export function AgentSessionLifecycle({
  projects,
}: {
  readonly projects: readonly EnvironmentAwenProject[];
}) {
  const close = useAgentSessionLifecycle();
  useEffect(() => {
    const threadFor = (target: ViewTarget): ScopedThreadRef | null => {
      if (target.kind === "newAgentSession") {
        const draft = useComposerDraftStore.getState().getDraftSession(target.draftId);
        return draft && draft.environmentId === target.environmentId
          ? scopeThreadRef(target.environmentId, draft.threadId)
          : null;
      }
      if (target.kind !== "agentSession") return null;
      for (const project of projects) {
        if (project.environmentId !== target.environmentId) continue;
        const workspace = project.workspaces.find((item) => item.id === target.workspaceId);
        const session = workspace?.sessions?.find((item) => item.id === target.agentSessionId);
        if (session?.kind === "agent")
          return scopeThreadRef(target.environmentId, session.threadId);
      }
      return null;
    };
    return useWorkbenchStore.getState().subscribeViewClosures((targets) => {
      const threads = new Map<string, ScopedThreadRef>();
      for (const target of targets) {
        const ref = threadFor(target);
        if (ref !== null) threads.set(scopedThreadKey(ref), ref);
      }
      for (const [key, ref] of threads) {
        void close(ref, {
          reason: "last-view",
          hasOpenView: () =>
            useWorkbenchStore.getState().tabs.some((tab) =>
              [...tab.panes.values()].some((view) => {
                const candidate = threadFor(view.target);
                return candidate !== null && scopedThreadKey(candidate) === key;
              }),
            ),
        });
      }
    });
  }, [close, projects]);
  return null;
}
