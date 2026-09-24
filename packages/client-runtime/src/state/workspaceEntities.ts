import { projectTerminalSessions } from "@awen/contracts";
import type {
  AwenProjectId,
  AwenProjectShell,
  EnvironmentId,
  OrchestrationShellSnapshot,
  WorkspaceId,
  TerminalSummary,
} from "@awen/contracts";
import { Atom } from "effect/unstable/reactivity";

import type { EnvironmentAwenProject } from "./models.ts";
import { enabledEnvironmentIds, type EnvironmentCatalogState } from "./connections.ts";

const EMPTY_PROJECTS: ReadonlyArray<EnvironmentAwenProject> = Object.freeze([]);

function snapshotProjects(
  snapshot: OrchestrationShellSnapshot | null,
): ReadonlyArray<AwenProjectShell> {
  return snapshot?.awenProjects ?? EMPTY_PROJECTS;
}

export function createEnvironmentWorkspaceAtoms(input: {
  readonly terminalMetadataAtom?: (
    environmentId: EnvironmentId,
  ) => Atom.Atom<ReadonlyArray<TerminalSummary> | null>;
  readonly catalogValueAtom: Atom.Atom<EnvironmentCatalogState>;
  readonly snapshotAtom: (
    environmentId: EnvironmentId,
  ) => Atom.Atom<OrchestrationShellSnapshot | null>;
}) {
  const environmentAwenProjectsAtom = Atom.family((environmentId: EnvironmentId) =>
    Atom.make((get): ReadonlyArray<EnvironmentAwenProject> =>
      (() => {
        const projects = snapshotProjects(get(input.snapshotAtom(environmentId)));
        const terminals = input.terminalMetadataAtom
          ? get(input.terminalMetadataAtom(environmentId))
          : null;
        return terminals === null ? projects : projectTerminalSessions(projects, terminals);
      })().map((project) => ({
        ...project,
        environmentId,
      })),
    ).pipe(Atom.withLabel(`environment-awen-projects:${environmentId}`)),
  );

  const awenProjectsAtom = Atom.make((get): ReadonlyArray<EnvironmentAwenProject> => {
    const projects: EnvironmentAwenProject[] = [];
    for (const environmentId of enabledEnvironmentIds(get(input.catalogValueAtom))) {
      projects.push(...get(environmentAwenProjectsAtom(environmentId)));
    }
    return projects.length === 0 ? EMPTY_PROJECTS : projects;
  }).pipe(Atom.withLabel("environment-awen-project-list"));

  const awenProjectAtom = Atom.family((key: string) => {
    const [environmentId, projectId] = JSON.parse(key) as [EnvironmentId, AwenProjectId];
    return Atom.make(
      (get) =>
        get(environmentAwenProjectsAtom(environmentId)).find(
          (project) => project.id === projectId,
        ) ?? null,
    ).pipe(Atom.withLabel(`environment-awen-project:${key}`));
  });

  const workspaceAtom = Atom.family((key: string) => {
    const [environmentId, workspaceId] = JSON.parse(key) as [EnvironmentId, WorkspaceId];
    return Atom.make((get) => {
      for (const project of get(environmentAwenProjectsAtom(environmentId))) {
        const workspace = project.workspaces.find((candidate) => candidate.id === workspaceId);
        if (workspace !== undefined) return { ...workspace, environmentId };
      }
      return null;
    }).pipe(Atom.withLabel(`environment-workspace:${key}`));
  });

  return {
    environmentAwenProjectsAtom,
    awenProjectsAtom,
    awenProjectAtom: (ref: {
      readonly environmentId: EnvironmentId;
      readonly projectId: AwenProjectId;
    }) =>
      awenProjectAtom(
        JSON.stringify([ref.environmentId, ref.projectId] satisfies ReadonlyArray<string>),
      ),
    workspaceAtom: (ref: {
      readonly environmentId: EnvironmentId;
      readonly workspaceId: WorkspaceId;
    }) =>
      workspaceAtom(
        JSON.stringify([ref.environmentId, ref.workspaceId] satisfies ReadonlyArray<string>),
      ),
  };
}
