import { useEffect, useRef, useState } from "react";
import { useRouter, useParams } from "@tanstack/react-router";

import { useAcodeProjects, useEnvironmentShellSnapshotPresent } from "../state/entities";
import { useComposerDraftStore } from "../composerDraftStore";
import { useEnvironmentCatalogSnapshot } from "../state/environmentCatalogSnapshot";
import { PaneTree } from "./PaneTree";
import {
  deepLinkInputFromParams,
  draftIdFromParams,
  resolveDeepLink,
  resolveNewAgentSessionTarget,
  type DeepLinkResolution,
} from "./deepLinks";
import { targetKey, type ViewTarget } from "./viewRegistry";
import "./viewDefinitions";
import { useWorkbenchStore } from "./workbenchStore";

interface WorkbenchProps {
  readonly navigate?: (input: {
    readonly to: string;
    readonly params: Record<string, string>;
    readonly replace?: boolean;
  }) => void;
}

/** The Workbench shell: URL recovery input plus Workbench command execution. */
export function Workbench({ navigate: navigateTo }: WorkbenchProps = {}) {
  const snapshot = useWorkbenchStore();
  const openTarget = useWorkbenchStore((s) => s.openTarget);
  const reconcileDraftWorkspaceBindings = useComposerDraftStore(
    (state) => state.reconcileDraftWorkspaceBindings,
  );
  const projects = useAcodeProjects();
  const router = useRouter();
  const navigate =
    navigateTo ??
    ((input: { to: string; params: Record<string, string>; replace?: boolean }) =>
      void router.navigate({
        to: input.to as never,
        params: input.params,
        ...(input.replace ? { replace: true } : {}),
      } as never));
  const [missingDismissed, setMissingDismissed] = useState(false);
  const handledRouteKeyRef = useRef<string | null>(null);

  const params = useParams({ strict: false }) as Parameters<typeof deepLinkInputFromParams>[0];
  const deepLinkInput = deepLinkInputFromParams(params);
  const draftId = draftIdFromParams(params as { draftId?: string });
  const draft = useComposerDraftStore((state) =>
    draftId === null ? null : state.getDraftSession(draftId),
  );
  const draftTarget =
    draftId === null || draft === null
      ? null
      : resolveNewAgentSessionTarget(draftId, draft, projects);
  const environmentId = deepLinkInput?.environmentId ?? null;
  const catalog = useEnvironmentCatalogSnapshot(environmentId);
  const environmentSnapshotPresent = useEnvironmentShellSnapshotPresent(environmentId);
  const resolution = resolveDeepLink(deepLinkInput, projects, {
    catalogReady: catalog.isReady,
    environmentExists: catalog.entry !== null,
    environmentEnabled: catalog.entry?.enabled === true,
    environmentSnapshotPresent,
  });
  // Observe active-to-closed/deleted transitions and clean up across Tabs.
  const activeSessionTargetsRef = useRef<Map<string, ViewTarget>>(new Map());
  useEffect(() => {
    const nextActiveTargets = new Map<string, ViewTarget>();
    for (const project of projects) {
      for (const workspace of project.workspaces) {
        for (const session of workspace.sessions ?? []) {
          if (session.kind !== "agent" && session.kind !== "terminal") continue;
          const target: ViewTarget =
            session.kind === "agent"
              ? {
                  kind: "agentSession",
                  environmentId: project.environmentId,
                  workspaceId: workspace.id,
                  agentSessionId: session.id,
                }
              : {
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
    const workspaces = projects.flatMap((project) =>
      project.workspaces.map((workspace) => ({
        environmentId: project.environmentId,
        workspaceId: workspace.id,
        workspaceRoot: workspace.workspaceRoot,
      })),
    );
    reconcileDraftWorkspaceBindings(workspaces);
  }, [projects, reconcileDraftWorkspaceBindings]);

  useEffect(() => {
    if (deepLinkInput === null || resolution.state !== "ready") return;
    const routeKey = `deep-link:${JSON.stringify(deepLinkInput)}`;
    if (handledRouteKeyRef.current === routeKey) return;
    handledRouteKeyRef.current = routeKey;
    if (resolution.legacy) {
      navigate({ ...resolution.canonicalRoute, replace: true });
      return;
    }
    openTarget(resolution.target);
  }, [deepLinkInput, navigate, openTarget, resolution]);

  useEffect(() => {
    if (draftTarget === null) return;
    const routeKey = `draft:${draftTarget.draftId}:${draftTarget.environmentId}:${draftTarget.workspaceId}`;
    if (handledRouteKeyRef.current === routeKey) return;
    handledRouteKeyRef.current = routeKey;
    openTarget(draftTarget);
  }, [draftTarget, openTarget]);

  return (
    <div className="flex h-full min-h-0 min-w-0 flex-1 flex-col">
      <DeepLinkStatus
        resolution={resolution}
        dismissed={missingDismissed}
        onDismiss={() => setMissingDismissed(true)}
      />
      <PaneTree snapshot={snapshot} />
    </div>
  );
}

function DeepLinkStatus({
  resolution,
  dismissed,
  onDismiss,
}: {
  readonly resolution: DeepLinkResolution;
  readonly dismissed: boolean;
  readonly onDismiss: () => void;
}) {
  if (resolution.state === "idle") return null;
  if (resolution.state === "pending") {
    return (
      <div
        role="status"
        className="flex h-7 shrink-0 items-center justify-between border-b border-border bg-muted/30 px-3 text-xs text-muted-foreground"
      >
        <span>Waiting for environment data…</span>
      </div>
    );
  }
  if (resolution.state !== "missing" || dismissed) return null;
  return (
    <div
      role="alert"
      className="flex h-7 shrink-0 items-center justify-between border-b border-border bg-destructive/10 px-3 text-xs text-muted-foreground"
    >
      <span>Session not found.</span>
      <button type="button" className="rounded px-1.5 hover:bg-accent" onClick={onDismiss}>
        Dismiss
      </button>
    </div>
  );
}
