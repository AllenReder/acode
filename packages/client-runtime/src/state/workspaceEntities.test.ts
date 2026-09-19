import {
  AcodeProjectId,
  AgentSessionId,
  ThreadId,
  type TerminalSummary,
  EnvironmentId,
  ProjectId,
  WorkspaceId,
  type OrchestrationShellSnapshot,
} from "@t3tools/contracts";
import { describe, expect, it } from "@effect/vitest";
import { Atom, AtomRegistry } from "effect/unstable/reactivity";

import type { EnvironmentCatalogState } from "./connections.ts";
import { createEnvironmentWorkspaceAtoms } from "./workspaceEntities.ts";

const LOCAL = EnvironmentId.make("daemon-local");
const REMOTE = EnvironmentId.make("daemon-remote");
const ACODE_PROJECT_ID = AcodeProjectId.make("acode-project:shared-local-id");
const WORKSPACE_ID = WorkspaceId.make("workspace:shared-local-id");
const T3_PROJECT_ID = ProjectId.make("shared-local-id");

function snapshot(title: string): OrchestrationShellSnapshot {
  return {
    snapshotSequence: 1,
    projects: [],
    threads: [],
    acodeProjects: [
      {
        id: ACODE_PROJECT_ID,
        title,
        workspaces: [
          {
            id: WORKSPACE_ID,
            projectId: ACODE_PROJECT_ID,
            t3ProjectId: T3_PROJECT_ID,
            title,
            workspaceRoot: "/same/path/on/both/daemons",
            role: "main",
            createdAt: "2026-09-18T00:00:00Z",
            updatedAt: "2026-09-18T00:00:00Z",
          },
        ],
        createdAt: "2026-09-18T00:00:00Z",
        updatedAt: "2026-09-18T00:00:00Z",
      },
    ],
    updatedAt: "2026-09-18T00:00:00Z",
  };
}

describe("environment ACode workspace entities", () => {
  it("keeps identical local ids and paths scoped to their daemon", () => {
    const snapshotAtoms = Atom.family((environmentId: EnvironmentId) =>
      Atom.make<OrchestrationShellSnapshot | null>(
        environmentId === LOCAL ? snapshot("Local checkout") : snapshot("Remote checkout"),
      ),
    );
    const catalogValueAtom = Atom.make({
      isReady: true,
      entries: new Map([
        [LOCAL, { enabled: true }],
        [REMOTE, { enabled: true }],
      ]),
    } as unknown as EnvironmentCatalogState);
    const workspaceEntities = createEnvironmentWorkspaceAtoms({
      catalogValueAtom,
      snapshotAtom: snapshotAtoms,
    });
    const registry = AtomRegistry.make();

    const projects = registry.get(workspaceEntities.acodeProjectsAtom);
    expect(projects).toHaveLength(2);
    expect(projects.map((project) => [project.environmentId, project.id])).toEqual([
      [LOCAL, ACODE_PROJECT_ID],
      [REMOTE, ACODE_PROJECT_ID],
    ]);
    expect(
      registry.get(
        workspaceEntities.workspaceAtom({ environmentId: LOCAL, workspaceId: WORKSPACE_ID }),
      ),
    ).toMatchObject({ environmentId: LOCAL, title: "Local checkout" });
    expect(
      registry.get(
        workspaceEntities.workspaceAtom({ environmentId: REMOTE, workspaceId: WORKSPACE_ID }),
      ),
    ).toMatchObject({ environmentId: REMOTE, title: "Remote checkout" });

    registry.dispose();
  });
});

it("projects live Terminal Sessions beside Agent Sessions and removes only the terminal on close", () => {
  const shell = snapshot("Project");
  const workspace = shell.acodeProjects![0]!.workspaces[0]!;
  const agent = {
    kind: "agent" as const,
    id: AgentSessionId.make("agent-1"),
    workspaceId: WORKSPACE_ID,
    threadId: ThreadId.make("thread-1"),
    title: "Agent",
    createdAt: workspace.createdAt,
    updatedAt: workspace.updatedAt,
  };
  const snapshotAtom = Atom.make<OrchestrationShellSnapshot | null>({
    ...shell,
    acodeProjects: [
      { ...shell.acodeProjects![0]!, workspaces: [{ ...workspace, sessions: [agent] }] },
    ],
  });
  const terminal: TerminalSummary = {
    workspaceId: WORKSPACE_ID,
    terminalId: "term-1",
    cwd: workspace.workspaceRoot,
    worktreePath: null,
    status: "running",
    pid: 42,
    exitCode: null,
    exitSignal: null,
    hasRunningSubprocess: false,
    label: "Shell",
    updatedAt: workspace.updatedAt,
  };
  const metadata = Atom.make<ReadonlyArray<TerminalSummary> | null>([terminal]);
  const entities = createEnvironmentWorkspaceAtoms({
    catalogValueAtom: Atom.make({
      isReady: true,
      entries: new Map([[LOCAL, { enabled: true }]]),
    } as unknown as EnvironmentCatalogState),
    snapshotAtom: () => snapshotAtom,
    terminalMetadataAtom: () => metadata,
  });
  const registry = AtomRegistry.make();
  const atom = entities.workspaceAtom({ environmentId: LOCAL, workspaceId: WORKSPACE_ID });
  const unmount = registry.mount(atom);
  expect(registry.get(atom)?.sessions).toEqual([
    agent,
    {
      kind: "terminal",
      id: "terminal-session:25:workspace:shared-local-id:term-1",
      workspaceId: WORKSPACE_ID,
      title: "Shell",
      createdAt: workspace.updatedAt,
      updatedAt: workspace.updatedAt,
    },
  ]);
  registry.set(metadata, []);
  expect(registry.get(atom)?.sessions).toEqual([agent]);
  unmount();
  registry.dispose();
});
