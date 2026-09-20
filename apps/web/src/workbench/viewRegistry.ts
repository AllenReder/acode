import { createElement, useMemo, useSyncExternalStore, type ComponentType } from "react";

import type {
  AgentSessionId,
  AcodeProjectId,
  EnvironmentId,
  TerminalSessionId,
  WorkspaceId,
} from "@t3tools/contracts";
import type { DraftId } from "../composerDraftStore";

/** Product identities only. Runtime identities belong to trusted adapters. */
export type ViewTarget = (
  | { readonly kind: "welcome" }
  | {
      readonly kind: "project";
      readonly environmentId: EnvironmentId;
      readonly projectId: AcodeProjectId;
    }
  | {
      readonly kind: "workspace";
      readonly environmentId: EnvironmentId;
      readonly workspaceId: WorkspaceId;
    }
  | {
      readonly kind: "agentSession";
      readonly environmentId: EnvironmentId;
      readonly workspaceId: WorkspaceId;
      readonly agentSessionId: AgentSessionId;
    }
  | {
      readonly kind: "newAgentSession";
      readonly environmentId: EnvironmentId;
      readonly workspaceId: WorkspaceId;
      readonly draftId: DraftId;
    }
  | {
      readonly kind: "workspaceTerminal";
      readonly environmentId: EnvironmentId;
      readonly workspaceId: WorkspaceId;
      readonly terminalSessionId: TerminalSessionId;
    }
) & { readonly definitionId?: string };

/** All known target kinds. The registry resolves a definition per kind. */
export type ViewKind = ViewTarget["kind"];

/**
 * Stable identity used by the workbench store to detect "the user is opening
 * this target again" — same `targetKey` means the workbench may surface an
 * existing View instance instead of creating a new one.
 */
export function targetKey(target: ViewTarget): string {
  switch (target.kind) {
    case "welcome":
      return "welcome";
    case "project":
      return JSON.stringify([
        target.kind,
        definitionIdForTarget(target),
        target.environmentId,
        target.projectId,
      ]);
    case "workspace":
      return JSON.stringify([
        target.kind,
        definitionIdForTarget(target),
        target.environmentId,
        target.workspaceId,
      ]);
    case "agentSession":
      return `agentSession:${target.environmentId}:${target.workspaceId}:${target.agentSessionId}`;
    case "newAgentSession":
      return `newAgentSession:${target.environmentId}:${target.workspaceId}:${target.draftId}`;
    case "workspaceTerminal":
      return `workspaceTerminal:${target.environmentId}:${target.workspaceId}:${target.terminalSessionId}`;
  }
}

/** Structural equality over `ViewTarget`. Used to compare the focus of two panes. */
export function targetsEqual(a: ViewTarget, b: ViewTarget): boolean {
  return targetKey(a) === targetKey(b);
}

/** Cached immutable snapshots; subscribe releases all resources on unsubscribe. */
export interface ViewDataSource<Data> {
  readonly getSnapshot: () => Data;
  readonly subscribe: (onChange: () => void) => () => void;
}

/** A specific granted command, bound by the host to an allowed target scope. */
export interface ViewCapability<Input = void, Output = void> {
  readonly execute: (input: Input) => Output;
}

export interface ViewPresentation<T extends ViewTarget = ViewTarget> {
  readonly target: T;
  readonly paneId: string;
  readonly focused: boolean;
  /** Explicit navigation can request focus even when the Pane is already focused. */
  readonly focusRequestId?: number;
  readonly availableSize: { readonly width: number; readonly height: number };
}

export interface ViewProps<T extends ViewTarget, Data, Capabilities> extends ViewPresentation<T> {
  readonly data: Data;
  readonly capabilities: Capabilities;
}

/**
 * bind is trusted host integration, never a service handle passed to a renderer.
 * It must be pure: subscriptions belong to the source and are owned by React.
 * This is a typed extension seam, not a sandbox for executing untrusted code.
 */
export interface ViewDefinition<
  T extends ViewTarget = ViewTarget,
  Data = null,
  Capabilities extends { readonly [K in keyof Capabilities]: ViewCapability<never, unknown> } =
    Readonly<Record<string, never>>,
> {
  readonly id: string;
  readonly label: string;
  readonly accepts: (target: ViewTarget) => target is T;
  readonly bind: (target: T) => {
    readonly dataSource: ViewDataSource<Data>;
    readonly capabilities: Capabilities;
  };
  readonly Component: ComponentType<ViewProps<T, Data, Capabilities>>;
}

interface RegisteredViewDefinition {
  readonly id: string;
  readonly label: string;
  readonly accepts: (target: ViewTarget) => boolean;
  readonly Component: ComponentType<ViewPresentation>;
}

export const emptyViewBinding = () => ({
  dataSource: { getSnapshot: () => null, subscribe: () => () => {} },
  capabilities: {},
});

const REGISTRY = new Map<string, RegisteredViewDefinition>();

export function definitionIdForTarget(target: ViewTarget): string {
  if (target.kind === "newAgentSession") return "agentSession";
  return target.definitionId ?? target.kind;
}

/** Close over generic types so registry dispatch needs no unsafe renderer casts. */
export function registerViewDefinition<
  T extends ViewTarget,
  Data,
  Capabilities extends { readonly [K in keyof Capabilities]: ViewCapability<never, unknown> },
>(definition: ViewDefinition<T, Data, Capabilities>): void {
  function BoundView(props: ViewPresentation<T>) {
    const binding = useMemo(() => definition.bind(props.target), [props.target]);
    const data = useSyncExternalStore(
      binding.dataSource.subscribe,
      binding.dataSource.getSnapshot,
      binding.dataSource.getSnapshot,
    );
    return createElement(definition.Component, {
      ...props,
      data,
      capabilities: binding.capabilities,
    });
  }
  REGISTRY.set(definition.id, {
    id: definition.id,
    label: definition.label,
    accepts: definition.accepts,
    Component: (props) =>
      definition.accepts(props.target)
        ? createElement(BoundView, { ...props, target: props.target })
        : null,
  });
}

export function resolveViewDefinition(target: ViewTarget): RegisteredViewDefinition | null {
  const definition = REGISTRY.get(definitionIdForTarget(target));
  return definition?.accepts(target) ? definition : null;
}

export function clearViewRegistry(): void {
  REGISTRY.clear();
}
