import type {
  AcodeProjectId,
  AcodeProjectShell,
  EnvironmentId,
  OrchestrationShellSnapshot,
  WorkspaceId,
} from "@t3tools/contracts";
import { Atom } from "effect/unstable/reactivity";

import type { EnvironmentAcodeProject } from "./models.ts";
import { enabledEnvironmentIds, type EnvironmentCatalogState } from "./connections.ts";

const EMPTY_PROJECTS: ReadonlyArray<EnvironmentAcodeProject> = Object.freeze([]);

function snapshotProjects(
  snapshot: OrchestrationShellSnapshot | null,
): ReadonlyArray<AcodeProjectShell> {
  return snapshot?.acodeProjects ?? EMPTY_PROJECTS;
}

export function createEnvironmentWorkspaceAtoms(input: {
  readonly catalogValueAtom: Atom.Atom<EnvironmentCatalogState>;
  readonly snapshotAtom: (
    environmentId: EnvironmentId,
  ) => Atom.Atom<OrchestrationShellSnapshot | null>;
}) {
  const environmentAcodeProjectsAtom = Atom.family((environmentId: EnvironmentId) =>
    Atom.make((get): ReadonlyArray<EnvironmentAcodeProject> =>
      snapshotProjects(get(input.snapshotAtom(environmentId))).map((project) => ({
        ...project,
        environmentId,
      })),
    ).pipe(Atom.withLabel(`environment-acode-projects:${environmentId}`)),
  );

  const acodeProjectsAtom = Atom.make((get): ReadonlyArray<EnvironmentAcodeProject> => {
    const projects: EnvironmentAcodeProject[] = [];
    for (const environmentId of enabledEnvironmentIds(get(input.catalogValueAtom))) {
      projects.push(...get(environmentAcodeProjectsAtom(environmentId)));
    }
    return projects.length === 0 ? EMPTY_PROJECTS : projects;
  }).pipe(Atom.withLabel("environment-acode-project-list"));

  const acodeProjectAtom = Atom.family((key: string) => {
    const [environmentId, projectId] = JSON.parse(key) as [EnvironmentId, AcodeProjectId];
    return Atom.make(
      (get) =>
        get(environmentAcodeProjectsAtom(environmentId)).find(
          (project) => project.id === projectId,
        ) ?? null,
    ).pipe(Atom.withLabel(`environment-acode-project:${key}`));
  });

  const workspaceAtom = Atom.family((key: string) => {
    const [environmentId, workspaceId] = JSON.parse(key) as [EnvironmentId, WorkspaceId];
    return Atom.make((get) => {
      for (const project of get(environmentAcodeProjectsAtom(environmentId))) {
        const workspace = project.workspaces.find((candidate) => candidate.id === workspaceId);
        if (workspace !== undefined) return { ...workspace, environmentId };
      }
      return null;
    }).pipe(Atom.withLabel(`environment-workspace:${key}`));
  });

  return {
    environmentAcodeProjectsAtom,
    acodeProjectsAtom,
    acodeProjectAtom: (ref: {
      readonly environmentId: EnvironmentId;
      readonly projectId: AcodeProjectId;
    }) =>
      acodeProjectAtom(
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
