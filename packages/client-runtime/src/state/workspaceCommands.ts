import type {
  EnvironmentId,
} from "@t3tools/contracts";
import { WS_METHODS as RpcMethods } from "@t3tools/contracts";
import { Atom } from "effect/unstable/reactivity";

import type { EnvironmentRegistry } from "../connection/registry.ts";
import { createAtomCommandScheduler, createEnvironmentRpcCommand } from "./runtime.ts";

const workspaceCommandScheduler = createAtomCommandScheduler();
const workspaceCommandConcurrency = {
  mode: "serial" as const,
  key: ({ environmentId, input }: {
    readonly environmentId: EnvironmentId;
    readonly input: { readonly projectId?: string; readonly workspaceId?: string };
  }) => JSON.stringify([environmentId, input.projectId ?? input.workspaceId]),
};

export function createEnvironmentWorkspaceCommandAtoms<R, E>(
  runtime: Atom.AtomRuntime<EnvironmentRegistry | R, E>,
) {
  return {
    associate: createEnvironmentRpcCommand(runtime, {
      label: "environment-data:workspace:associate",
      tag: RpcMethods.acodeWorkspaceAssociate,
      scheduler: workspaceCommandScheduler,
      concurrency: workspaceCommandConcurrency,
    }),
    createWorktree: createEnvironmentRpcCommand(runtime, {
      label: "environment-data:workspace:create-worktree",
      tag: RpcMethods.acodeWorkspaceCreateWorktree,
      scheduler: workspaceCommandScheduler,
      concurrency: workspaceCommandConcurrency,
    }),
    remove: createEnvironmentRpcCommand(runtime, {
      label: "environment-data:workspace:remove",
      tag: RpcMethods.acodeWorkspaceRemove,
      scheduler: workspaceCommandScheduler,
      concurrency: workspaceCommandConcurrency,
    }),
    rename: createEnvironmentRpcCommand(runtime, {
      label: "environment-data:workspace:rename",
      tag: RpcMethods.acodeWorkspaceRename,
      scheduler: workspaceCommandScheduler,
      concurrency: workspaceCommandConcurrency,
    }),
  };
}
