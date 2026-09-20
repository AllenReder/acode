import {
  AcodeProjectId,
  AcodeWorkspaceError,
  type AcodeWorkspaceAssociateInput,
  type AcodeWorkspaceAssociateResult,
  type AcodeWorkspaceCreateWorktreeInput,
  type AcodeWorkspaceCreateWorktreeResult,
  type AcodeWorkspaceRemoveInput,
  type AcodeWorkspaceRemoveResult,
  type AcodeWorkspaceRenameInput,
  type AcodeWorkspaceRenameResult,
  type AcodeProjectRenameInput,
  type AcodeProjectRenameResult,
  CommandId,
  ProjectId,
  type AcodeProjectShell,
  type AcodeWorkspaceShell,
  WorkspaceId,
} from "@t3tools/contracts";
import * as Cause from "effect/Cause";
import * as Context from "effect/Context";
import * as Crypto from "effect/Crypto";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Path from "effect/Path";
import * as Result from "effect/Result";
import * as Schema from "effect/Schema";

import * as OrchestrationEngine from "../orchestration/Services/OrchestrationEngine.ts";
import * as ProjectionSnapshotQuery from "../orchestration/Services/ProjectionSnapshotQuery.ts";
import * as ServerConfig from "../config.ts";
import * as GitWorkflowService from "../git/GitWorkflowService.ts";
import * as GitVcsDriver from "../vcs/GitVcsDriver.ts";
import * as VcsDriverRegistry from "../vcs/VcsDriverRegistry.ts";
import * as WorkspacePaths from "./WorkspacePaths.ts";

/**
 * Server-side owner of ACode Workspace identity and worktree lifecycle.
 *
 * The orchestration project remains the durable event boundary. This service
 * validates the physical worktree first, then emits a project.create/delete
 * command that the existing projection pipeline turns into an ACode sibling.
 * Git is never invoked through a shell string assembled from user input.
 */
export class AcodeWorkspaceService extends Context.Service<
  AcodeWorkspaceService,
  {
    readonly associate: (
      input: AcodeWorkspaceAssociateInput,
    ) => Effect.Effect<AcodeWorkspaceAssociateResult, AcodeWorkspaceError>;
    readonly createWorktree: (
      input: AcodeWorkspaceCreateWorktreeInput,
    ) => Effect.Effect<AcodeWorkspaceCreateWorktreeResult, AcodeWorkspaceError>;
    readonly remove: (
      input: AcodeWorkspaceRemoveInput,
    ) => Effect.Effect<AcodeWorkspaceRemoveResult, AcodeWorkspaceError>;
    readonly rename: (
      input: AcodeWorkspaceRenameInput,
    ) => Effect.Effect<AcodeWorkspaceRenameResult, AcodeWorkspaceError>;
    readonly renameProject: (
      input: AcodeProjectRenameInput,
    ) => Effect.Effect<AcodeProjectRenameResult, AcodeWorkspaceError>;
  }
>()("t3/workspace/AcodeWorkspaceService") {}

type Repository = {
  readonly rootPath: string;
  readonly commonDir: string;
};

function workspaceError(
  reason: AcodeWorkspaceError["reason"],
  detail: string,
  path?: string,
  cause?: unknown,
): AcodeWorkspaceError {
  return new AcodeWorkspaceError({
    reason,
    detail,
    ...(path === undefined ? {} : { path }),
    ...(cause === undefined ? {} : { cause }),
  });
}

function isInsideOrEqual(pathService: Path.Path, parent: string, candidate: string): boolean {
  const relative = pathService.relative(parent, candidate);
  return (
    relative === "" ||
    (relative !== ".." &&
      !relative.startsWith(`..${pathService.sep}`) &&
      !pathService.isAbsolute(relative))
  );
}

function isSamePath(pathService: Path.Path, left: string, right: string): boolean {
  return pathService.relative(left, right) === "";
}

function pathSlug(value: string): string {
  const slug = value
    .trim()
    .replace(/[^A-Za-z0-9._-]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return slug.length === 0 ? "detached" : slug;
}

function allWorkspaces(
  projects: ReadonlyArray<AcodeProjectShell>,
): ReadonlyArray<AcodeWorkspaceShell> {
  return projects.flatMap((project) => project.workspaces);
}

/** @public Service construction is part of the canonical Effect module API. */
export const make = Effect.gen(function* () {
  const crypto = yield* Crypto.Crypto;
  const fileSystem = yield* FileSystem.FileSystem;
  const pathService = yield* Path.Path;
  const serverConfig = yield* ServerConfig.ServerConfig;
  const workspacePaths = yield* WorkspacePaths.WorkspacePaths;
  const vcsRegistry = yield* VcsDriverRegistry.VcsDriverRegistry;
  const git = yield* GitVcsDriver.GitVcsDriver;
  const gitWorkflow = yield* GitWorkflowService.GitWorkflowService;
  const projectionQuery = yield* ProjectionSnapshotQuery.ProjectionSnapshotQuery;
  const orchestrationEngine = yield* OrchestrationEngine.OrchestrationEngineService;

  const readAcodeProject = (projectId: AcodeProjectId) => {
    const getter = projectionQuery.getAcodeProjectById;
    if (getter === undefined) {
      return Effect.fail(
        workspaceError(
          "project-not-found",
          `ACode Project '${projectId}' is not available on this server.`,
        ),
      );
    }
    return getter(projectId).pipe(
      Effect.flatMap(
        Option.match({
          onNone: () =>
            Effect.fail(
              workspaceError("project-not-found", `ACode Project '${projectId}' was not found.`),
            ),
          onSome: Effect.succeed,
        }),
      ),
      Effect.mapError((cause) =>
        Schema.is(AcodeWorkspaceError)(cause)
          ? cause
          : workspaceError(
              "registration-failed",
              `Could not read ACode Project '${projectId}'.`,
              undefined,
              cause,
            ),
      ),
    );
  };

  const readWorkspace = (workspaceId: WorkspaceId) => {
    const getter = projectionQuery.getAcodeWorkspaceById;
    if (getter === undefined) return Effect.succeed(Option.none<AcodeWorkspaceShell>());
    return getter(workspaceId);
  };

  const readAllProjects = () =>
    projectionQuery.getShellSnapshot().pipe(
      Effect.map((snapshot) => snapshot.acodeProjects ?? []),
      Effect.mapError((cause) =>
        workspaceError(
          "registration-failed",
          "Failed to read registered ACode Workspaces.",
          undefined,
          cause,
        ),
      ),
    );

  const realPathOrResolved = (value: string) =>
    fileSystem.realPath(value).pipe(Effect.orElseSucceed(() => pathService.resolve(value)));

  const normalizeExistingDirectory = (value: string) =>
    workspacePaths.normalizeWorkspaceRoot(value).pipe(
      Effect.mapError((cause) => workspaceError("path-not-found", cause.message, value, cause)),
      Effect.flatMap((resolved) =>
        realPathOrResolved(resolved).pipe(
          Effect.mapError((cause) =>
            workspaceError(
              "path-not-found",
              `Could not resolve worktree path '${value}'.`,
              value,
              cause,
            ),
          ),
        ),
      ),
    );

  const resolveRepository = (cwd: string, pathForError = cwd) =>
    vcsRegistry.resolve({ cwd }).pipe(
      Effect.catchCause((cause) =>
        Effect.fail(
          workspaceError(
            "not-a-repository",
            `The path '${pathForError}' is not a supported Git worktree.`,
            pathForError,
            Cause.squash(cause),
          ),
        ),
      ),
      Effect.flatMap((handle) => {
        if (handle.kind !== "git" || handle.repository.metadataPath === null) {
          return Effect.fail(
            workspaceError(
              "not-a-repository",
              `The path '${pathForError}' is not a supported Git worktree.`,
              pathForError,
            ),
          );
        }
        const metadataPath = handle.repository.metadataPath.trim();
        const commonDir = pathService.isAbsolute(metadataPath)
          ? metadataPath
          : pathService.resolve(handle.repository.rootPath, metadataPath);
        return Effect.all({
          rootPath: realPathOrResolved(handle.repository.rootPath),
          commonDir: realPathOrResolved(commonDir),
        }).pipe(
          Effect.mapError((cause) =>
            workspaceError(
              "git-failed",
              `Could not inspect Git worktree '${pathForError}'.`,
              pathForError,
              cause,
            ),
          ),
        );
      }),
    );

  const registeredWorkspaceAt = (
    projects: ReadonlyArray<AcodeProjectShell>,
    candidate: string,
  ): AcodeWorkspaceShell | undefined =>
    allWorkspaces(projects).find((workspace) =>
      isSamePath(pathService, pathService.resolve(workspace.workspaceRoot), candidate),
    );

  const rejectNestedWorkspace = (
    projects: ReadonlyArray<AcodeProjectShell>,
    candidate: string,
    allowWorkspaceId?: WorkspaceId,
  ) => {
    const conflict = allWorkspaces(projects).find((workspace) => {
      if (allowWorkspaceId !== undefined && workspace.id === allowWorkspaceId) return false;
      const registered = pathService.resolve(workspace.workspaceRoot);
      return (
        isInsideOrEqual(pathService, registered, candidate) ||
        isInsideOrEqual(pathService, candidate, registered)
      );
    });
    return conflict === undefined
      ? Effect.void
      : Effect.fail(
          workspaceError(
            "path-conflict",
            `Worktree path '${candidate}' conflicts with registered Workspace '${conflict.workspaceRoot}'.`,
            candidate,
          ),
        );
  };

  const mainWorkspaceFor = (project: AcodeProjectShell) => {
    const workspace =
      project.workspaces.find((candidate) => candidate.role === "main") ?? project.workspaces[0];
    return workspace === undefined
      ? Effect.fail(
          workspaceError(
            "project-not-found",
            `ACode Project '${project.id}' has no main Workspace.`,
          ),
        )
      : Effect.succeed(workspace);
  };

  const assertSameRepository = (mainRoot: string, targetRoot: string) =>
    Effect.all({ main: resolveRepository(mainRoot), target: resolveRepository(targetRoot) }).pipe(
      Effect.flatMap(({ main, target }) =>
        main.commonDir === target.commonDir
          ? Effect.succeed({ main, target })
          : Effect.fail(
              workspaceError(
                "different-repository",
                `Worktree '${targetRoot}' belongs to a different Git repository than '${mainRoot}'.`,
                targetRoot,
              ),
            ),
      ),
    );

  const dispatchCreate = (input: {
    readonly project: AcodeProjectShell;
    readonly workspaceRoot: string;
    readonly title: string;
    readonly origin: "associated" | "acode-created";
  }) =>
    Effect.gen(function* () {
      const uuid = yield* crypto.randomUUIDv4;
      const projectId = ProjectId.make(`acode-workspace:${uuid}`);
      const createdAt = DateTime.formatIso(yield* DateTime.now);
      yield* orchestrationEngine.dispatch({
        type: "project.create",
        commandId: CommandId.make(`acode-workspace:create:${uuid}`),
        projectId,
        title: input.title,
        workspaceRoot: input.workspaceRoot,
        createWorkspaceRootIfMissing: false,
        acodeWorkspace: {
          acodeProjectId: input.project.id,
          role: "worktree",
          origin: input.origin,
        },
        createdAt,
      });
      return projectId;
    });

  const registeredWorkspaceFor = (projectId: AcodeProjectId, workspaceRoot: string) =>
    readAcodeProject(projectId).pipe(
      Effect.flatMap((project) => {
        const workspace = project.workspaces.find((candidate) =>
          isSamePath(pathService, pathService.resolve(candidate.workspaceRoot), workspaceRoot),
        );
        return workspace === undefined
          ? Effect.fail(
              workspaceError(
                "registration-failed",
                `Workspace '${workspaceRoot}' was not visible after registration.`,
                workspaceRoot,
              ),
            )
          : Effect.succeed(workspace);
      }),
    );

  const associate: AcodeWorkspaceService["Service"]["associate"] = Effect.fn(
    "AcodeWorkspaceService.associate",
  )(function* (input) {
    const project = yield* readAcodeProject(input.projectId);
    const mainWorkspace = yield* mainWorkspaceFor(project);
    const targetRoot = yield* normalizeExistingDirectory(input.path);
    const projects = yield* readAllProjects();
    const { target: targetRepository } = yield* assertSameRepository(
      mainWorkspace.workspaceRoot,
      targetRoot,
    );
    // Git may resolve a path supplied inside a checkout to its top-level root.
    // A Workspace always owns that root, never an arbitrary subdirectory.
    const checkoutRoot = targetRepository.rootPath;
    const existing = registeredWorkspaceAt(projects, checkoutRoot);
    if (existing !== undefined) {
      if (existing.projectId === input.projectId) {
        return { workspace: existing, reused: true };
      }
      return yield* workspaceError(
        "already-registered",
        `Worktree '${checkoutRoot}' is already registered under another ACode Project.`,
        checkoutRoot,
      );
    }
    yield* rejectNestedWorkspace(projects, checkoutRoot);

    const title = input.title?.trim() || pathService.basename(checkoutRoot) || "workspace";
    const t3ProjectId = yield* dispatchCreate({
      project,
      workspaceRoot: checkoutRoot,
      title,
      origin: "associated",
    }).pipe(
      Effect.mapError((cause) =>
        Schema.is(AcodeWorkspaceError)(cause)
          ? cause
          : workspaceError(
              "registration-failed",
              `Failed to register worktree '${checkoutRoot}'.`,
              checkoutRoot,
              cause,
            ),
      ),
    );
    const workspace = yield* registeredWorkspaceFor(input.projectId, checkoutRoot);
    // Keep the generated T3 identity observable in the projection even though
    // the returned Workspace identity is the public value callers need.
    void t3ProjectId;
    return { workspace, reused: false };
  });

  const createWorktree: AcodeWorkspaceService["Service"]["createWorktree"] = Effect.fn(
    "AcodeWorkspaceService.createWorktree",
  )(function* (input) {
    const project = yield* readAcodeProject(input.projectId);
    const mainWorkspace = yield* mainWorkspaceFor(project);
    const mainRoot = pathService.resolve(mainWorkspace.workspaceRoot);
    const mainRepository = yield* resolveRepository(mainRoot);
    const baseRef = input.baseRef?.trim() || "HEAD";
    const resolvedBase = yield* git
      .resolveCommit({ cwd: mainRoot, revision: baseRef })
      .pipe(
        Effect.mapError((cause) =>
          workspaceError(
            "invalid-ref",
            `Base ref '${baseRef}' does not resolve to a commit.`,
            mainRoot,
            cause,
          ),
        ),
      );
    const mainStatus = yield* git
      .statusDetails(mainRoot)
      .pipe(
        Effect.mapError((cause) =>
          workspaceError(
            "git-failed",
            `Could not inspect the main worktree '${mainRoot}'.`,
            mainRoot,
            cause,
          ),
        ),
      );
    if (mainStatus.hasWorkingTreeChanges) {
      return yield* workspaceError(
        "dirty-worktree",
        `The main Workspace '${mainRoot}' has uncommitted or untracked changes.`,
        mainRoot,
      );
    }

    const managedDefaultPath = pathService.join(
      serverConfig.worktreesDir,
      pathService.basename(mainRoot) || "project",
      pathSlug(input.newBranch ?? `detached-${resolvedBase.commitSha.slice(0, 12)}`),
    );
    const requestedPath = input.path?.trim() || managedDefaultPath;
    const requestedAbsolutePath = pathService.resolve(requestedPath);
    const projects = yield* readAllProjects();
    const existingRegistered = registeredWorkspaceAt(projects, requestedAbsolutePath);
    if (existingRegistered !== undefined) {
      if (existingRegistered.projectId === input.projectId) {
        return {
          workspace: existingRegistered,
          worktreePath: existingRegistered.workspaceRoot,
          worktreeCreated: false,
        };
      }
      return yield* workspaceError(
        "already-registered",
        `Worktree '${requestedAbsolutePath}' is already registered under another ACode Project.`,
        requestedAbsolutePath,
      );
    }
    yield* rejectNestedWorkspace(projects, requestedAbsolutePath);

    const destinationExists = yield* fileSystem
      .exists(requestedAbsolutePath)
      .pipe(
        Effect.mapError((cause) =>
          workspaceError(
            "path-conflict",
            `Could not inspect worktree destination '${requestedAbsolutePath}'.`,
            requestedAbsolutePath,
            cause,
          ),
        ),
      );
    let worktreeCreated = false;
    let workspaceRoot = requestedAbsolutePath;
    let origin: "associated" | "acode-created" = "acode-created";
    if (destinationExists) {
      const stat = yield* fileSystem
        .stat(requestedAbsolutePath)
        .pipe(
          Effect.mapError((cause) =>
            workspaceError(
              "path-conflict",
              `Could not inspect worktree destination '${requestedAbsolutePath}'.`,
              requestedAbsolutePath,
              cause,
            ),
          ),
        );
      if (stat.type !== "Directory") {
        return yield* workspaceError(
          "path-conflict",
          `Worktree destination '${requestedAbsolutePath}' is not a directory.`,
          requestedAbsolutePath,
        );
      }
      const existingRepository = yield* resolveRepository(
        requestedAbsolutePath,
        requestedAbsolutePath,
      ).pipe(
        Effect.mapError((cause) =>
          workspaceError(
            "path-conflict",
            `Worktree destination '${requestedAbsolutePath}' is not a completed Git worktree.`,
            requestedAbsolutePath,
            cause,
          ),
        ),
      );
      if (existingRepository.commonDir !== mainRepository.commonDir) {
        return yield* workspaceError(
          "path-conflict",
          `Worktree destination '${requestedAbsolutePath}' belongs to another repository.`,
          requestedAbsolutePath,
        );
      }
      workspaceRoot = existingRepository.rootPath;
      if (!isSamePath(pathService, workspaceRoot, requestedAbsolutePath)) {
        return yield* workspaceError(
          "path-conflict",
          `Worktree destination '${requestedAbsolutePath}' is nested inside another worktree.`,
          requestedAbsolutePath,
        );
      }
      // A retry after Git succeeded but ACode registration failed reuses the
      // existing checkout only inside the daemon-managed worktrees root. An
      // existing explicit path elsewhere must be associated explicitly, so a
      // user-owned checkout can never become an ACode-deletable directory.
      const managedRoot = pathService.resolve(serverConfig.worktreesDir);
      if (!isInsideOrEqual(pathService, managedRoot, workspaceRoot)) {
        return yield* workspaceError(
          "path-conflict",
          `Destination '${workspaceRoot}' already exists outside ACode's managed worktrees directory; associate it instead.`,
          workspaceRoot,
        );
      }
      origin = "acode-created";
    } else {
      yield* fileSystem
        .makeDirectory(pathService.dirname(requestedAbsolutePath), { recursive: true })
        .pipe(
          Effect.mapError((cause) =>
            workspaceError(
              "path-conflict",
              `Could not prepare worktree destination '${requestedAbsolutePath}'.`,
              requestedAbsolutePath,
              cause,
            ),
          ),
        );
      yield* gitWorkflow
        .createWorktree({
          cwd: mainRoot,
          refName: input.newBranch === undefined ? resolvedBase.commitSha : baseRef,
          ...(input.newBranch === undefined
            ? { detach: true }
            : { newRefName: input.newBranch, baseRefName: baseRef }),
          path: requestedAbsolutePath,
        })
        .pipe(
          Effect.mapError((cause) =>
            workspaceError(
              input.newBranch === undefined ? "git-failed" : "branch-exists",
              `Git could not create worktree '${requestedAbsolutePath}'.`,
              requestedAbsolutePath,
              cause,
            ),
          ),
        );
      worktreeCreated = true;
    }

    const title = input.title?.trim() || pathService.basename(workspaceRoot) || "workspace";
    yield* dispatchCreate({
      project,
      workspaceRoot,
      title,
      origin,
    }).pipe(
      Effect.mapError((cause) =>
        Schema.is(AcodeWorkspaceError)(cause)
          ? cause
          : workspaceError(
              "registration-failed",
              `Worktree '${workspaceRoot}' was created but could not be registered. The directory was kept.`,
              workspaceRoot,
              cause,
            ),
      ),
    );
    const workspace = yield* registeredWorkspaceFor(input.projectId, workspaceRoot);
    return { workspace, worktreePath: workspaceRoot, worktreeCreated };
  });

  const remove: AcodeWorkspaceService["Service"]["remove"] = (input) =>
    Effect.gen(function* () {
      const workspaceOption = yield* readWorkspace(input.workspaceId).pipe(
        Effect.mapError((cause) =>
          workspaceError(
            "registration-failed",
            `Could not read Workspace '${input.workspaceId}'.`,
            undefined,
            cause,
          ),
        ),
      );
      if (Option.isNone(workspaceOption)) {
        return { removed: false, deletedDirectory: false };
      }
      const workspace = workspaceOption.value;
      if ((workspace.sessions?.length ?? 0) > 0) {
        return yield* workspaceError(
          "workspace-not-empty",
          `Workspace '${workspace.title}' still has active Sessions. Stop them before removing it.`,
          workspace.workspaceRoot,
        );
      }
      const shouldDeleteDirectory = input.deleteDirectory === true;
      if (shouldDeleteDirectory && workspace.role === "main") {
        return yield* workspaceError(
          "main-checkout-protected",
          "The main checkout can be unregistered, but it cannot be deleted by this action.",
          workspace.workspaceRoot,
        );
      }
      if (shouldDeleteDirectory && workspace.origin !== "acode-created") {
        return yield* workspaceError(
          "not-acode-created",
          "This Workspace was associated from disk; remove its registration without deleting the directory.",
          workspace.workspaceRoot,
        );
      }

      let mainWorkspace: AcodeWorkspaceShell | undefined;
      if (shouldDeleteDirectory) {
        const project = yield* readAcodeProject(workspace.projectId);
        mainWorkspace = yield* mainWorkspaceFor(project);
        yield* assertSameRepository(mainWorkspace.workspaceRoot, workspace.workspaceRoot);
        const exists = yield* fileSystem
          .exists(workspace.workspaceRoot)
          .pipe(
            Effect.mapError((cause) =>
              workspaceError(
                "git-failed",
                `Could not inspect Workspace '${workspace.workspaceRoot}'.`,
                workspace.workspaceRoot,
                cause,
              ),
            ),
          );
        if (exists) {
          const status = yield* git
            .statusDetails(workspace.workspaceRoot)
            .pipe(
              Effect.mapError((cause) =>
                workspaceError(
                  "git-failed",
                  `Could not inspect Workspace '${workspace.workspaceRoot}'.`,
                  workspace.workspaceRoot,
                  cause,
                ),
              ),
            );
          if (status.hasWorkingTreeChanges) {
            return yield* workspaceError(
              "dirty-worktree",
              `Workspace '${workspace.workspaceRoot}' has uncommitted or untracked changes.`,
              workspace.workspaceRoot,
            );
          }
        }
      }

      const commandId = yield* crypto.randomUUIDv4.pipe(
        Effect.map((uuid) => CommandId.make(`acode-workspace:remove:${uuid}`)),
      );
      yield* orchestrationEngine
        .dispatch({
          type: "project.delete",
          commandId,
          projectId: workspace.t3ProjectId,
          force: false,
        })
        .pipe(
          Effect.mapError((cause) =>
            workspaceError(
              cause instanceof Error && cause.message.toLowerCase().includes("not empty")
                ? "workspace-not-empty"
                : "registration-failed",
              `Could not remove Workspace '${workspace.workspaceRoot}' from ACode.`,
              workspace.workspaceRoot,
              cause,
            ),
          ),
        );

      if (!shouldDeleteDirectory || mainWorkspace === undefined) {
        return { removed: true, deletedDirectory: false };
      }
      const deletion = yield* gitWorkflow
        .removeWorktree({ cwd: mainWorkspace.workspaceRoot, path: workspace.workspaceRoot })
        .pipe(Effect.result);
      if (Result.isFailure(deletion)) {
        yield* Effect.logWarning(
          "Workspace registration removed but Git directory cleanup failed",
          {
            workspaceRoot: workspace.workspaceRoot,
            cause: deletion.failure,
          },
        );
        return {
          removed: true,
          deletedDirectory: false,
          warning:
            "Workspace registration was removed, but the directory was kept because Git cleanup failed.",
        };
      }
      return { removed: true, deletedDirectory: true };
    }).pipe(
      Effect.catchCause((cause) => {
        const error = Cause.squash(cause);
        return Effect.fail(
          Schema.is(AcodeWorkspaceError)(error)
            ? error
            : workspaceError(
                "git-failed",
                `Workspace operation failed for '${input.workspaceId}'.`,
                undefined,
                error,
              ),
        );
      }),
    );

  const rename: AcodeWorkspaceService["Service"]["rename"] = (input) =>
    Effect.gen(function* () {
      const workspaceOption = yield* readWorkspace(input.workspaceId).pipe(
        Effect.mapError((cause) =>
          workspaceError(
            "registration-failed",
            `Could not read Workspace '${input.workspaceId}'.`,
            undefined,
            cause,
          ),
        ),
      );
      if (Option.isNone(workspaceOption)) {
        return yield* workspaceError(
          "workspace-not-found",
          `Workspace '${input.workspaceId}' was not found.`,
        );
      }
      const updateTitle = projectionQuery.updateAcodeWorkspaceTitle;
      if (updateTitle === undefined) {
        return yield* workspaceError(
          "registration-failed",
          "Workspace rename is unavailable on this server.",
          workspaceOption.value.workspaceRoot,
        );
      }
      const updatedAt = DateTime.formatIso(yield* DateTime.now);
      yield* updateTitle({
        workspaceId: input.workspaceId,
        title: input.title,
        updatedAt,
      }).pipe(
        Effect.mapError((cause) =>
          workspaceError(
            "registration-failed",
            `Could not rename Workspace '${input.workspaceId}'.`,
            workspaceOption.value.workspaceRoot,
            cause,
          ),
        ),
      );
      const updated = yield* readWorkspace(input.workspaceId).pipe(
        Effect.mapError((cause) =>
          workspaceError(
            "registration-failed",
            `Could not read Workspace '${input.workspaceId}' after rename.`,
            workspaceOption.value.workspaceRoot,
            cause,
          ),
        ),
      );
      if (Option.isNone(updated)) {
        return yield* workspaceError(
          "workspace-not-found",
          `Workspace '${input.workspaceId}' disappeared after rename.`,
        );
      }
      return { workspace: updated.value };
    });

  const renameProject: AcodeWorkspaceService["Service"]["renameProject"] = (input) =>
    Effect.gen(function* () {
      yield* readAcodeProject(input.projectId);
      const updateTitle = projectionQuery.updateAcodeProjectTitle;
      if (updateTitle === undefined) {
        return yield* workspaceError(
          "registration-failed",
          "Project rename is unavailable on this server.",
        );
      }
      const updatedAt = DateTime.formatIso(yield* DateTime.now);
      yield* updateTitle({
        acodeProjectId: input.projectId,
        title: input.title,
        updatedAt,
      }).pipe(
        Effect.mapError((cause) =>
          workspaceError(
            "registration-failed",
            `Could not rename ACode Project '${input.projectId}'.`,
            undefined,
            cause,
          ),
        ),
      );
      return { project: yield* readAcodeProject(input.projectId) };
    });

  return AcodeWorkspaceService.of({
    associate,
    createWorktree,
    remove,
    rename,
    renameProject,
  });
});

export const layer = Layer.effect(AcodeWorkspaceService, make);
