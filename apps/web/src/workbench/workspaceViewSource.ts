import { Atom } from "effect/unstable/reactivity";
import { appAtomRegistry } from "../rpc/atomRegistry";
import { environmentWorkspace } from "../state/projects";
import type { ViewDataSource } from "./viewRegistry";
import type { WelcomeData } from "./workspaceViews";

/** Project only presentation data: no Thread bindings, PTYs, stores, or RPC handles. */
const workspaceSummaries = Atom.make((get): WelcomeData =>
  get(environmentWorkspace.acodeProjectsAtom).flatMap((project) =>
    project.workspaces.map((workspace) => ({
      target: {
        kind: "workspace",
        environmentId: project.environmentId,
        workspaceId: workspace.id,
      },
      title: workspace.title,
      projectTitle: project.title,
      sessions: (workspace.sessions ?? []).map((session) => ({
        title: session.title,
        target:
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
              },
      })),
    })),
  ),
);

export const workspaceViewSource: ViewDataSource<WelcomeData> = {
  getSnapshot: () => appAtomRegistry.get(workspaceSummaries),
  subscribe: (listener) => appAtomRegistry.subscribe(workspaceSummaries, listener),
};
