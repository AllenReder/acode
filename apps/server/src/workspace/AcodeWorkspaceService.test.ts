import * as NodeServices from "@effect/platform-node/NodeServices";
import { assert, describe, it } from "@effect/vitest";
import {
  AcodeProjectId,
  type AcodeProjectShell,
  type AcodeWorkspaceShell,
  ProjectId,
  WorkspaceId,
  workspaceIdForT3Project,
} from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Path from "effect/Path";
import * as DateTime from "effect/DateTime";

import * as ServerConfig from "../config.ts";
import * as GitWorkflowService from "../git/GitWorkflowService.ts";
import * as GitVcsDriver from "../vcs/GitVcsDriver.ts";
import * as VcsDriverRegistry from "../vcs/VcsDriverRegistry.ts";
import * as OrchestrationEngine from "../orchestration/Services/OrchestrationEngine.ts";
import * as ProjectionSnapshotQuery from "../orchestration/Services/ProjectionSnapshotQuery.ts";
import * as WorkspacePaths from "./WorkspacePaths.ts";
import * as AcodeWorkspaceService from "./AcodeWorkspaceService.ts";

const NOW = "2026-09-19T00:00:00.000Z";

function mainWorkspace(root: string): AcodeWorkspaceShell {
  return {
    id: WorkspaceId.make("workspace:main"),
    projectId: AcodeProjectId.make("acode-project:main"),
    t3ProjectId: ProjectId.make("project-main"),
    title: "main",
    workspaceRoot: root,
    role: "main",
    sessions: [],
    createdAt: NOW,
    updatedAt: NOW,
  };
}

function makeProject(root: string, workspace = mainWorkspace(root)): AcodeProjectShell {
  return {
    id: AcodeProjectId.make("acode-project:main"),
    title: "Repository",
    workspaces: [workspace],
    createdAt: NOW,
    updatedAt: NOW,
  };
}

function makeRepositoryHandle(root: string, commonDir: string): VcsDriverRegistry.VcsDriverHandle {
  return {
    kind: "git",
    repository: {
      kind: "git",
      rootPath: root,
      metadataPath: commonDir,
      freshness: {
        source: "live-local",
        observedAt: DateTime.makeUnsafe(NOW),
        expiresAt: Option.none(),
      },
    },
    driver: {} as VcsDriverRegistry.VcsDriverHandle["driver"],
  };
}

const makeLayer = (input: {
  readonly root: string;
  readonly sibling: string;
  readonly commonDir: string;
  readonly targetCommonDir?: string;
  readonly dirty?: boolean;
  readonly onCreate?: (input: Parameters<GitWorkflowService.GitWorkflowService["Service"]["createWorktree"]>[0]) => void;
  readonly onDispatch: (command: Parameters<OrchestrationEngine.OrchestrationEngineService["Service"]["dispatch"]>[0]) => void;
  readonly readProject: () => AcodeProjectShell;
  readonly readWorkspace: () => Option.Option<AcodeWorkspaceShell>;
}) => {
  const serverConfigLayer = ServerConfig.layerTest(process.cwd(), {
    prefix: "acode-workspace-service-test-",
  });
  const projectionLayer = Layer.mock(ProjectionSnapshotQuery.ProjectionSnapshotQuery)({
    getAcodeProjectById: () => Effect.succeed(Option.some(input.readProject())),
    getAcodeWorkspaceById: () => Effect.succeed(input.readWorkspace()),
    getShellSnapshot: () =>
      Effect.succeed({
        snapshotSequence: 1,
        projects: [],
        threads: [],
        acodeProjects: [input.readProject()],
        updatedAt: NOW,
      }),
  });
  const registryLayer = Layer.mock(VcsDriverRegistry.VcsDriverRegistry)({
    resolve: (request) =>
      Effect.succeed(
        makeRepositoryHandle(
          request.cwd === input.root ? input.root : input.sibling,
          request.cwd === input.root ? input.commonDir : (input.targetCommonDir ?? input.commonDir),
        ),
      ),
  });
  const gitLayer = Layer.mock(GitVcsDriver.GitVcsDriver)({
    resolveCommit: () => Effect.succeed({ commitSha: "0123456789abcdef0123456789abcdef01234567" }),
    statusDetails: () =>
      Effect.succeed({
        isRepo: true,
        hasOriginRemote: false,
        isDefaultBranch: true,
        branch: "main",
        headCommit: "0123456789abcdef0123456789abcdef01234567",
        upstreamRef: null,
        hasWorkingTreeChanges: input.dirty === true,
        workingTree: { files: [], insertions: 0, deletions: 0 },
        hasUpstream: false,
        aheadCount: 0,
        behindCount: 0,
        aheadOfDefaultCount: 0,
      }),
  });
  const workflowLayer = Layer.mock(GitWorkflowService.GitWorkflowService)({
    createWorktree: (request, _options) => {
      input.onCreate?.(request);
      return Effect.succeed({ worktree: { path: request.path!, refName: request.refName } });
    },
    removeWorktree: () => Effect.void,
  });
  const orchestrationLayer = Layer.mock(OrchestrationEngine.OrchestrationEngineService)({
    dispatch: (command, _options) => Effect.sync(() => {
      input.onDispatch(command);
      return { sequence: 1 };
    }),
  });

  return AcodeWorkspaceService.layer.pipe(
    Layer.provide(projectionLayer),
    Layer.provide(registryLayer),
    Layer.provide(gitLayer),
    Layer.provide(workflowLayer),
    Layer.provide(orchestrationLayer),
    Layer.provide(WorkspacePaths.layer),
    Layer.provide(serverConfigLayer),
    Layer.provideMerge(NodeServices.layer),
  );
};

describe("AcodeWorkspaceService", () => {
  it.effect("associates a sibling worktree and records its origin", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const fileSystem = yield* FileSystem.FileSystem;
        const path = yield* Path.Path;
        const parent = yield* fileSystem.makeTempDirectoryScoped({ prefix: "acode-associate-" });
        const root = path.join(parent, "main");
        const sibling = path.join(parent, "sibling");
        yield* fileSystem.makeDirectory(root, { recursive: true });
        yield* fileSystem.makeDirectory(sibling, { recursive: true });
        let project = makeProject(root);
        let dispatched:
          | Parameters<OrchestrationEngine.OrchestrationEngineService["Service"]["dispatch"]>[0]
          | undefined;
        const result = yield* Effect.gen(function* () {
          const service = yield* AcodeWorkspaceService.AcodeWorkspaceService;
          return yield* service.associate({
            projectId: project.id,
            path: sibling,
            title: "feature worktree",
          });
        }).pipe(
          Effect.provide(
            makeLayer({
              root,
              sibling,
              commonDir: path.join(parent, ".git"),
              onDispatch: (command) => {
                dispatched = command;
                if (command.type === "project.create") {
                  project = {
                    ...project,
                    workspaces: [
                      ...project.workspaces,
                      {
                        id: workspaceIdForT3Project(command.projectId),
                        projectId: project.id,
                        t3ProjectId: command.projectId,
                        title: command.title,
                        workspaceRoot: command.workspaceRoot,
                        role: "worktree",
                        origin: command.acodeWorkspace?.origin,
                        sessions: [],
                        createdAt: command.createdAt,
                        updatedAt: command.createdAt,
                      },
                    ],
                  };
                }
              },
              readProject: () => project,
              readWorkspace: () => Option.none(),
            }),
          ),
        );
        assert.equal(dispatched?.type, "project.create");
        if (dispatched?.type === "project.create") {
          assert.deepEqual(dispatched.acodeWorkspace, {
            acodeProjectId: project.id,
            role: "worktree",
            origin: "associated",
          });
        }
        assert.equal(result.reused, false);
      }),
    ).pipe(Effect.provide(NodeServices.layer)),
  );

  it.effect("rejects a worktree from a different Git common directory", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const fileSystem = yield* FileSystem.FileSystem;
        const path = yield* Path.Path;
        const parent = yield* fileSystem.makeTempDirectoryScoped({ prefix: "acode-different-repo-" });
        const root = path.join(parent, "main");
        const sibling = path.join(parent, "other");
        yield* fileSystem.makeDirectory(root, { recursive: true });
        yield* fileSystem.makeDirectory(sibling, { recursive: true });
        const error = yield* Effect.gen(function* () {
          const service = yield* AcodeWorkspaceService.AcodeWorkspaceService;
          return yield* service.associate({
            projectId: AcodeProjectId.make("acode-project:main"),
            path: sibling,
          });
        }).pipe(
          Effect.flip,
          Effect.provide(
            makeLayer({
              root,
              sibling,
              commonDir: path.join(root, ".git"),
              targetCommonDir: path.join(sibling, ".git"),
              onDispatch: () => undefined,
              readProject: () => makeProject(root),
              readWorkspace: () => Option.none(),
            }),
          ),
        );
        assert.equal(error.reason, "different-repository");
      }),
    ).pipe(Effect.provide(NodeServices.layer)),
  );

  it.effect("creates a detached worktree before registering it", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const fileSystem = yield* FileSystem.FileSystem;
        const path = yield* Path.Path;
        const parent = yield* fileSystem.makeTempDirectoryScoped({ prefix: "acode-create-" });
        const root = path.join(parent, "main");
        const sibling = path.join(parent, "created");
        yield* fileSystem.makeDirectory(root, { recursive: true });
        let project = makeProject(root);
        let createInput: Parameters<GitWorkflowService.GitWorkflowService["Service"]["createWorktree"]>[0] | undefined;
        const result = yield* Effect.gen(function* () {
          const service = yield* AcodeWorkspaceService.AcodeWorkspaceService;
          return yield* service.createWorktree({
            projectId: project.id,
            baseRef: "HEAD",
            path: sibling,
          });
        }).pipe(
          Effect.provide(
            makeLayer({
              root,
              sibling,
              commonDir: path.join(parent, ".git"),
              onCreate: (input) => {
                createInput = input;
              },
              onDispatch: (command) => {
                if (command.type === "project.create") {
                  project = {
                    ...project,
                    workspaces: [
                      ...project.workspaces,
                      {
                        id: workspaceIdForT3Project(command.projectId),
                        projectId: project.id,
                        t3ProjectId: command.projectId,
                        title: command.title,
                        workspaceRoot: command.workspaceRoot,
                        role: "worktree",
                        origin: command.acodeWorkspace?.origin,
                        sessions: [],
                        createdAt: command.createdAt,
                        updatedAt: command.createdAt,
                      },
                    ],
                  };
                }
              },
              readProject: () => project,
              readWorkspace: () => Option.none(),
            }),
          ),
        );
        assert.equal(createInput?.detach, true);
        assert.equal(result.worktreeCreated, true);
        assert.equal(result.workspace.origin, "acode-created");
      }),
    ).pipe(Effect.provide(NodeServices.layer)),
  );

  it.effect("protects the main Workspace from directory deletion", () =>
    Effect.gen(function* () {
      const service = yield* AcodeWorkspaceService.AcodeWorkspaceService;
      const error = yield* service
        .remove({ workspaceId: WorkspaceId.make("workspace:main"), deleteDirectory: true })
        .pipe(Effect.flip);
      assert.equal(error.reason, "main-checkout-protected");
    }).pipe(
      Effect.provide(
        makeLayer({
          root: "/tmp/main",
          sibling: "/tmp/sibling",
          commonDir: "/tmp/main/.git",
          onDispatch: () => undefined,
          readProject: () => makeProject("/tmp/main"),
          readWorkspace: () => Option.some(mainWorkspace("/tmp/main")),
        }),
      ),
    ),
  );
});
