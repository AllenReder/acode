import type { ComponentType } from "react";

import type {
  AgentSessionId,
  EnvironmentId,
  TerminalSessionId,
  WorkspaceId,
} from "@t3tools/contracts";

/**
 * The discriminated union of targets a View instance can bind to.
 *
 * C10 ships exactly two:
 *   - `agentSession`: a Workspace-owned Agent Session.
 *   - `workspaceTerminal`: a Workspace-owned Terminal Session.
 *
 * Both carry an ACode Session identity rather than a runtime identity: the T3
 * thread and the PTY terminal id are adapter details behind `urlBridge.ts` and
 * `sessionTarget.ts`.
 *
 * Adding a new target kind is a 3-step change:
 *   1. extend this union,
 *   2. register a matching `ViewDefinition` in `viewDefinitions.ts`,
 *   3. teach the Sidebar to emit it as a click target.
 *
 * Targets are deliberately flat — they carry enough identity for the workbench
 * to dedupe (two Pane instances showing the same target is the same Agent
 * conversation) without coupling to the rendering component.
 */
export type ViewTarget =
  | {
      readonly kind: "agentSession";
      readonly environmentId: EnvironmentId;
      readonly workspaceId: WorkspaceId;
      readonly agentSessionId: AgentSessionId;
    }
  | {
      readonly kind: "workspaceTerminal";
      readonly environmentId: EnvironmentId;
      readonly workspaceId: WorkspaceId;
      readonly terminalSessionId: TerminalSessionId;
    };

/** All known target kinds. The registry resolves a definition per kind. */
export type ViewKind = ViewTarget["kind"];

/**
 * Stable identity used by the workbench store to detect "the user is opening
 * this target again" — same `targetKey` means the workbench may surface an
 * existing View instance instead of creating a new one.
 */
export function targetKey(target: ViewTarget): string {
  switch (target.kind) {
    case "agentSession":
      return `agentSession:${target.environmentId}:${target.workspaceId}:${target.agentSessionId}`;
    case "workspaceTerminal":
      return `workspaceTerminal:${target.environmentId}:${target.workspaceId}:${target.terminalSessionId}`;
  }
}

/** Structural equality over `ViewTarget`. Used to compare the focus of two panes. */
export function targetsEqual(a: ViewTarget, b: ViewTarget): boolean {
  if (a.kind !== b.kind) return false;
  if (a.environmentId !== b.environmentId) return false;
  if (a.workspaceId !== b.workspaceId) return false;
  switch (a.kind) {
    case "agentSession":
      return b.kind === "agentSession" && a.agentSessionId === b.agentSessionId;
    case "workspaceTerminal":
      return b.kind === "workspaceTerminal" && a.terminalSessionId === b.terminalSessionId;
  }
}

/**
 * A registered View definition describes what it can render. The registry is
 * in-app (per Q2 of the C10 grill) — see `viewDefinitions.ts` for the
 * definitions that ship in v1.
 *
 * `Component` receives the target, the pane's stable id, and a focus flag.
 * Implementations should treat the focus flag as their sole subscription to
 * "is this pane the focused one right now" — there is exactly one focused
 * pane at a time.
 */
export interface ViewDefinition<T extends ViewTarget = ViewTarget> {
  readonly id: ViewKind;
  readonly label: string;
  readonly accepts: (target: ViewTarget) => target is T;
  readonly Component: ComponentType<{
    readonly target: T;
    readonly paneId: string;
    readonly focused: boolean;
    readonly availableSize: { readonly width: number; readonly height: number };
  }>;
}

const REGISTRY = new Map<ViewKind, ViewDefinition>();

/** Register a View definition. Overwrites any existing definition for the same kind. */
export function registerViewDefinition<T extends ViewTarget>(
  definition: ViewDefinition<T>,
): void {
  REGISTRY.set(definition.id, definition as unknown as ViewDefinition);
}

/** Look up the definition that renders a given target. Returns null if none is registered. */
export function resolveViewDefinition(target: ViewTarget): ViewDefinition | null {
  return REGISTRY.get(target.kind) ?? null;
}

/** Test seam. Clears all registered definitions. */
export function clearViewRegistry(): void {
  REGISTRY.clear();
}