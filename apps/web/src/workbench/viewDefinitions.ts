import { AgentView } from "./AgentView";
import { TerminalView } from "./TerminalView";
import { registerViewDefinition, type ViewDefinition, type ViewTarget } from "./viewRegistry";

/**
 * The two View definitions C10 ships. Both are registered at module load so
 * `resolveViewDefinition` returns a non-null Component for any in-app target.
 *
 * Adding a new View later:
 *   1. extend the `ViewTarget` union in `viewRegistry.ts`,
 *   2. write a Component matching the `ViewDefinition` props,
 *   3. register it here.
 *
 * Per the C10 grill (Q2), the registry is in-app: there is no plugin loader.
 */
export const agentViewDefinition: ViewDefinition<
  Extract<ViewTarget, { kind: "agentSession" }>
> = {
  id: "agentSession",
  label: "Agent",
  accepts: (target): target is Extract<ViewTarget, { kind: "agentSession" }> =>
    target.kind === "agentSession",
  Component: AgentView,
};

export const terminalViewDefinition: ViewDefinition<
  Extract<ViewTarget, { kind: "workspaceTerminal" }>
> = {
  id: "workspaceTerminal",
  label: "Terminal",
  accepts: (target): target is Extract<ViewTarget, { kind: "workspaceTerminal" }> =>
    target.kind === "workspaceTerminal",
  Component: TerminalView,
};

let registered = false;

/**
 * Idempotent module-load registration. Calling more than once is a no-op so
 * HMR and concurrent imports stay safe.
 */
export function registerCoreViewDefinitions(): void {
  if (registered) return;
  registerViewDefinition(agentViewDefinition);
  registerViewDefinition(terminalViewDefinition);
  registered = true;
}

registerCoreViewDefinitions();