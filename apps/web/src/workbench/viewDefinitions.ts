import { createWorkspaceViewDefinitions } from "./workspaceViews";
import { workspaceViewSource } from "./workspaceViewSource";
import { useWorkbenchStore } from "./workbenchStore";
import { AgentView } from "./AgentView";
import { TerminalView } from "./TerminalView";
import {
  emptyViewBinding,
  registerViewDefinition,
  type ViewDefinition,
  type ViewTarget,
} from "./viewRegistry";

// Agent/Terminal remain trusted runtime adapters. Their migration to dedicated
// data sources belongs to the Session adapter tickets; no handles cross this seam.
export const agentViewDefinition: ViewDefinition<Extract<ViewTarget, { kind: "agentSession" }>> = {
  id: "agentSession",
  label: "Agent",
  accepts: (target): target is Extract<ViewTarget, { kind: "agentSession" }> =>
    target.kind === "agentSession",
  bind: emptyViewBinding,
  Component: AgentView,
};

export const terminalViewDefinition: ViewDefinition<
  Extract<ViewTarget, { kind: "workspaceTerminal" }>
> = {
  id: "workspaceTerminal",
  label: "Terminal",
  accepts: (target): target is Extract<ViewTarget, { kind: "workspaceTerminal" }> =>
    target.kind === "workspaceTerminal",
  bind: emptyViewBinding,
  Component: TerminalView,
};

let registered = false;

/**
 * Idempotent module-load registration. Calling more than once is a no-op so
 * HMR and concurrent imports stay safe.
 */
export function registerCoreViewDefinitions(): void {
  if (registered) return;
  const definitions = createWorkspaceViewDefinitions(workspaceViewSource, (target) =>
    useWorkbenchStore.getState().openTarget(target),
  );
  registerViewDefinition(definitions.welcome);
  registerViewDefinition(definitions.workspace);
  registerViewDefinition(agentViewDefinition);
  registerViewDefinition(terminalViewDefinition);
  registered = true;
}

registerCoreViewDefinitions();
