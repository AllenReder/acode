import type {
  AcodeWorkspaceShell,
  ContextMenuItem,
  EnvironmentId,
  ProjectId,
  ThreadId,
  WorkspaceId,
} from "@t3tools/contracts";
import type { EnvironmentAcodeProject } from "@t3tools/client-runtime/state/models";
import {
  isAtomCommandInterrupted,
  squashAtomCommandFailure,
} from "@t3tools/client-runtime/state/runtime";
import { useAtomValue } from "@effect/atom-react";
import {
  ChevronDownIcon,
  ChevronRightIcon,
  FolderIcon,
  GitBranchIcon,
  PlusIcon,
  TerminalIcon,
} from "lucide-react";
import { useCallback, useMemo, useState, type KeyboardEvent, type MouseEvent } from "react";
import { useNavigate } from "@tanstack/react-router";

import { useComposerDraftStore } from "../composerDraftStore";
import { openCommandPalette } from "../commandPaletteBus";
import { newDraftId, newThreadId } from "../lib/utils";
import { readLocalApi } from "../localApi";
import { environmentServerConfigsAtom } from "../state/server";
import { useEnvironments } from "../state/environments";
import { useAcodeProjects } from "../state/entities";
import { projectEnvironment, workspaceEnvironment } from "../state/projects";
import { terminalEnvironment } from "../state/terminal";
import { threadEnvironment } from "../state/threads";
import { useAtomCommand } from "../state/use-atom-command";
import { scopeProjectRef } from "@t3tools/client-runtime/environment";
import { SessionRow } from "./sidebar/SessionRow";
import { nextWorkspaceTerminalId } from "./Sidebar.logic";
import { stackedThreadToast, toastManager } from "./ui/toast";
import { SidebarContent, SidebarGroup, SidebarGroupLabel } from "./ui/sidebar";
import { sessionRouteForTarget } from "../workbench/deepLinks";
import { runtimeTerminalIdForTarget, terminalTargetForRuntime } from "../workbench/sessionTarget";
import type { ViewTarget } from "../workbench/viewRegistry";
import { useWorkbenchStore } from "../workbench/workbenchStore";

type ProjectMenuId =
  | "new-project"
  | "associate-worktree"
  | "new-worktree"
  | "rename-project"
  | "remove-project";

type WorkspaceMenuId =
  | "new-agent-session"
  | "new-terminal-session"
  | "rename-workspace"
  | "remove-registration"
  | "delete-directory";

function commandFailureToast(title: string, error: unknown) {
  toastManager.add(
    stackedThreadToast({
      type: "error",
      title,
      description: error instanceof Error ? error.message : "An error occurred.",
    }),
  );
}

export function projectMenuItems(input: {
  readonly canManageWorkspaces: boolean;
}): ReadonlyArray<ContextMenuItem<ProjectMenuId>> {
  return [
    { id: "new-project", label: "New project", icon: "folder-plus" },
    ...(input.canManageWorkspaces
      ? ([
          { id: "associate-worktree", label: "Associate Workspace", icon: "folder-input" },
          { id: "new-worktree", label: "New Worktree", icon: "git-branch" },
        ] satisfies ContextMenuItem<ProjectMenuId>[])
      : []),
    { id: "rename-project", label: "Rename project", icon: "pencil", separatorBefore: true },
    {
      id: "remove-project",
      label: "Remove project",
      icon: "trash",
      destructive: true,
      separatorBefore: true,
    },
  ];
}

export function workspaceMenuItems(input: {
  readonly canDeleteDirectory: boolean;
}): ReadonlyArray<ContextMenuItem<WorkspaceMenuId>> {
  return [
    { id: "new-agent-session", label: "New Agent Session", icon: "message-square-plus" },
    { id: "new-terminal-session", label: "New Terminal Session", icon: "terminal" },
    { id: "rename-workspace", label: "Rename", icon: "pencil", separatorBefore: true },
    {
      id: "remove-registration",
      label: "Remove registration",
      icon: "unlink",
      separatorBefore: true,
    },
    ...(input.canDeleteDirectory
      ? ([
          {
            id: "delete-directory",
            label: "Delete workspace directory",
            icon: "trash",
            destructive: true,
            separatorBefore: true,
          },
        ] satisfies ContextMenuItem<WorkspaceMenuId>[])
      : []),
  ];
}

export function projectDeleteInputs(project: EnvironmentAcodeProject): ReadonlyArray<{
  readonly environmentId: EnvironmentId;
  readonly input: { readonly projectId: ProjectId; readonly force: true };
}> {
  return project.workspaces.map((workspace) => ({
    environmentId: project.environmentId,
    input: { projectId: workspace.t3ProjectId, force: true },
  }));
}

function rowKeydown(handler: (rect: DOMRect) => void) {
  return (event: KeyboardEvent<HTMLElement>) => {
    if (event.key === "ContextMenu" || (event.shiftKey && event.key === "F10")) {
      event.preventDefault();
      event.stopPropagation();
      handler(event.currentTarget.getBoundingClientRect());
    }
  };
}

export function AcodeSidebar() {
  const navigate = useNavigate();
  const projects = useAcodeProjects();
  const { environments } = useEnvironments();
  const connectedEnvironmentIds = useMemo(
    () =>
      new Set(
        environments
          .filter((environment) => environment.connection.phase === "connected")
          .map((environment) => environment.environmentId),
      ),
    [environments],
  );
  const serverConfigs = useAtomValue(environmentServerConfigsAtom);
  const [collapsedProjects, setCollapsedProjects] = useState<ReadonlySet<string>>(new Set());
  const [expandedWorkspaces, setExpandedWorkspaces] = useState<ReadonlySet<string>>(new Set());
  const [historyExpanded, setHistoryExpanded] = useState<ReadonlySet<string>>(new Set());

  const associateWorkspace = useAtomCommand(workspaceEnvironment.associate);
  const createWorktree = useAtomCommand(workspaceEnvironment.createWorktree);
  const removeWorkspace = useAtomCommand(workspaceEnvironment.remove);
  const renameWorkspace = useAtomCommand(workspaceEnvironment.rename);
  const renameProject = useAtomCommand(workspaceEnvironment.renameProject);
  const deleteProject = useAtomCommand(projectEnvironment.delete);
  const openTerminal = useAtomCommand(terminalEnvironment.open);
  const renameTerminalSession = useAtomCommand(terminalEnvironment.rename);
  const updateThreadMetadata = useAtomCommand(threadEnvironment.updateMetadata);

  const openAddProject = useCallback(() => openCommandPalette({ open: "add-project" }), []);

  const toggleWorkspaceExpanded = useCallback((workspaceKey: string) => {
    setExpandedWorkspaces((current) => {
      const next = new Set(current);
      if (next.has(workspaceKey)) next.delete(workspaceKey);
      else next.add(workspaceKey);
      return next;
    });
  }, []);

  const openDraft = useCallback(
    (
      environmentId: EnvironmentId,
      workspaceId: WorkspaceId,
      draftId: ReturnType<typeof newDraftId>,
    ) => {
      useWorkbenchStore.getState().openTarget({
        kind: "newAgentSession",
        environmentId,
        workspaceId,
        draftId,
      });
      void navigate({ to: "/draft/$draftId", params: { draftId } });
    },
    [navigate],
  );

  const newAgentSession = useCallback(
    (project: EnvironmentAcodeProject, workspace: AcodeWorkspaceShell) => {
      const drafts = useComposerDraftStore.getState();
      const existing = drafts.getDraftSessionByWorkspace(project.environmentId, workspace.id);
      if (existing !== null) {
        openDraft(project.environmentId, workspace.id, existing.draftId);
        return;
      }
      const draftId = newDraftId();
      drafts.setWorkspaceDraftThreadId(
        workspace.id,
        scopeProjectRef(project.environmentId, workspace.t3ProjectId),
        draftId,
        { threadId: newThreadId(), createdAt: new Date().toISOString() },
      );
      openDraft(project.environmentId, workspace.id, draftId);
    },
    [openDraft],
  );

  const newTerminalSession = useCallback(
    (project: EnvironmentAcodeProject, workspace: AcodeWorkspaceShell) => {
      const terminalId = nextWorkspaceTerminalId();
      void openTerminal({
        environmentId: project.environmentId,
        input: { workspaceId: workspace.id, terminalId },
      }).then((result) => {
        if (result._tag === "Failure") {
          if (!isAtomCommandInterrupted(result)) {
            commandFailureToast("Unable to create terminal", squashAtomCommandFailure(result));
          }
          return;
        }
        const target = terminalTargetForRuntime({
          environmentId: project.environmentId,
          workspaceId: workspace.id,
          terminalId,
        });
        useWorkbenchStore.getState().openTarget(target);
        const route = sessionRouteForTarget(target);
        void navigate({ to: route.to as never, params: route.params, replace: true } as never);
      });
    },
    [navigate, openTerminal],
  );

  const associateExisting = useCallback(
    (project: EnvironmentAcodeProject) => {
      const path = window.prompt("Path of an existing Git worktree");
      if (!path?.trim()) return;
      void associateWorkspace({
        environmentId: project.environmentId,
        input: { projectId: project.id, path },
      }).then((result) => {
        if (result._tag === "Failure" && !isAtomCommandInterrupted(result)) {
          commandFailureToast("Could not associate Workspace", squashAtomCommandFailure(result));
        }
      });
    },
    [associateWorkspace],
  );

  const addWorktree = useCallback(
    (project: EnvironmentAcodeProject) => {
      const newBranch = window.prompt("New branch name (leave blank for detached HEAD)");
      if (newBranch === null) return;
      const baseRef = window.prompt("Base branch, tag, or commit", "HEAD");
      if (baseRef === null) return;
      const path = window.prompt("Destination path (leave blank for the managed worktrees folder)");
      if (path === null) return;
      void createWorktree({
        environmentId: project.environmentId,
        input: {
          projectId: project.id,
          ...(newBranch.trim() ? { newBranch } : {}),
          ...(baseRef.trim() ? { baseRef } : {}),
          ...(path.trim() ? { path } : {}),
        },
      }).then((result) => {
        if (result._tag === "Failure" && !isAtomCommandInterrupted(result)) {
          commandFailureToast("Could not create Worktree", squashAtomCommandFailure(result));
        }
      });
    },
    [createWorktree],
  );

  const removeAcodeProject = useCallback(
    (project: EnvironmentAcodeProject) => {
      if (!window.confirm(`Remove project "${project.title}" and its Sessions?`)) return;
      void (async () => {
        for (const command of projectDeleteInputs(project)) {
          const result = await deleteProject(command);
          if (result._tag === "Failure" && !isAtomCommandInterrupted(result)) {
            commandFailureToast("Could not remove project", squashAtomCommandFailure(result));
            return;
          }
        }
      })();
    },
    [deleteProject],
  );

  const handleProjectMenu = useCallback(
    (project: EnvironmentAcodeProject, position: { x: number; y: number }) => {
      const api = readLocalApi();
      if (!api) return;
      void (async () => {
        const clicked = await api.contextMenu.show(
          projectMenuItems({
            canManageWorkspaces:
              serverConfigs.get(project.environmentId)?.environment.capabilities
                .workspaceManagement === true,
          }),
          position,
        );
        if (clicked === null) return;
        if (clicked === "new-project") openAddProject();
        if (clicked === "associate-worktree") associateExisting(project);
        if (clicked === "new-worktree") addWorktree(project);
        if (clicked === "rename-project") {
          const title = window.prompt("Project name", project.title)?.trim();
          if (!title) return;
          void renameProject({
            environmentId: project.environmentId,
            input: { projectId: project.id, title },
          }).then((result) => {
            if (result._tag === "Failure" && !isAtomCommandInterrupted(result)) {
              commandFailureToast("Could not rename project", squashAtomCommandFailure(result));
            }
          });
        }
        if (clicked === "remove-project") removeAcodeProject(project);
      })();
    },
    [
      addWorktree,
      associateExisting,
      openAddProject,
      removeAcodeProject,
      renameProject,
      serverConfigs,
    ],
  );

  const handleWorkspaceMenu = useCallback(
    (
      project: EnvironmentAcodeProject,
      workspace: AcodeWorkspaceShell,
      position: { x: number; y: number },
    ) => {
      const api = readLocalApi();
      if (!api) return;
      void (async () => {
        const clicked = await api.contextMenu.show(
          workspaceMenuItems({ canDeleteDirectory: workspace.origin === "acode-created" }),
          position,
        );
        if (clicked === null) return;
        if (clicked === "new-agent-session") newAgentSession(project, workspace);
        if (clicked === "new-terminal-session") newTerminalSession(project, workspace);
        if (clicked === "rename-workspace") {
          const title = window.prompt("Workspace name", workspace.title)?.trim();
          if (!title) return;
          void renameWorkspace({
            environmentId: project.environmentId,
            input: { workspaceId: workspace.id, title },
          }).then((result) => {
            if (result._tag === "Failure" && !isAtomCommandInterrupted(result)) {
              commandFailureToast("Could not rename Workspace", squashAtomCommandFailure(result));
            }
          });
        }
        if (clicked === "remove-registration") {
          if (!window.confirm(`Remove Workspace "${workspace.title}" from this project?`)) return;
          void removeWorkspace({
            environmentId: project.environmentId,
            input: { workspaceId: workspace.id },
          }).then((result) => {
            if (result._tag === "Failure" && !isAtomCommandInterrupted(result)) {
              commandFailureToast("Could not remove Workspace", squashAtomCommandFailure(result));
            }
          });
        }
        if (clicked === "delete-directory") {
          if (!window.confirm(`Remove Workspace "${workspace.title}" and delete its directory?`)) {
            return;
          }
          void removeWorkspace({
            environmentId: project.environmentId,
            input: { workspaceId: workspace.id, deleteDirectory: true },
          }).then((result) => {
            if (result._tag === "Failure" && !isAtomCommandInterrupted(result)) {
              commandFailureToast("Could not delete Workspace", squashAtomCommandFailure(result));
            }
          });
        }
      })();
    },
    [newAgentSession, newTerminalSession, removeWorkspace, renameWorkspace],
  );

  const renameAgent = useCallback(
    (environmentId: EnvironmentId, threadId: ThreadId, currentTitle: string) => {
      const title = window.prompt("Session name", currentTitle)?.trim();
      if (!title) return;
      void updateThreadMetadata({ environmentId, input: { threadId, title } }).then((result) => {
        if (result._tag === "Failure" && !isAtomCommandInterrupted(result)) {
          commandFailureToast("Could not rename Agent Session", squashAtomCommandFailure(result));
        }
      });
    },
    [updateThreadMetadata],
  );

  const renameTerminal = useCallback(
    (target: Extract<ViewTarget, { kind: "workspaceTerminal" }>, currentTitle: string) => {
      const title = window.prompt("Session name", currentTitle)?.trim();
      if (!title) return;
      const terminalId = runtimeTerminalIdForTarget(target);
      if (!terminalId) {
        commandFailureToast(
          "Could not rename Terminal Session",
          new Error("Terminal id is unavailable."),
        );
        return;
      }
      void renameTerminalSession({
        environmentId: target.environmentId,
        input: { workspaceId: target.workspaceId, terminalId, title },
      }).then((result) => {
        if (result._tag === "Failure" && !isAtomCommandInterrupted(result)) {
          commandFailureToast(
            "Could not rename Terminal Session",
            squashAtomCommandFailure(result),
          );
        }
      });
    },
    [renameTerminalSession],
  );

  if (projects.length === 0) {
    return (
      <SidebarContent className="gap-0">
        <SidebarGroup className="px-2 py-2">
          <button
            type="button"
            data-testid="sidebar-add-project"
            className="flex h-8 items-center gap-2 rounded-md px-2 text-xs hover:bg-sidebar-row-hover"
            onClick={openAddProject}
          >
            <PlusIcon className="size-3.5" /> Add Project
          </button>
        </SidebarGroup>
      </SidebarContent>
    );
  }

  return (
    <SidebarContent className="gap-0">
      <SidebarGroup className="px-2 py-2">
        <button
          type="button"
          data-testid="sidebar-add-project"
          className="flex h-8 items-center gap-2 rounded-md px-2 text-xs hover:bg-sidebar-row-hover"
          onClick={openAddProject}
        >
          <PlusIcon className="size-3.5" /> Add Project
        </button>
      </SidebarGroup>
      <SidebarGroup className="min-h-0 flex-1 overflow-auto px-2 pb-2">
        <SidebarGroupLabel>Projects</SidebarGroupLabel>
        <div
          role="tree"
          aria-label="Projects, Workspaces, and Sessions"
          className="flex flex-col gap-px"
        >
          {projects.map((project) => {
            const projectKey = `${project.environmentId}:${project.id}`;
            const projectCollapsed = collapsedProjects.has(projectKey);
            return (
              <div key={projectKey} role="treeitem" aria-expanded={!projectCollapsed}>
                <button
                  type="button"
                  data-testid="sidebar-project-row"
                  className="flex h-7 w-full items-center gap-1.5 rounded-md px-2 text-left text-xs font-medium hover:bg-sidebar-row-hover"
                  onClick={() =>
                    setCollapsedProjects((current) => {
                      const next = new Set(current);
                      if (next.has(projectKey)) next.delete(projectKey);
                      else next.add(projectKey);
                      return next;
                    })
                  }
                  onContextMenu={(event: MouseEvent<HTMLButtonElement>) => {
                    event.preventDefault();
                    event.stopPropagation();
                    handleProjectMenu(project, { x: event.clientX, y: event.clientY });
                  }}
                  onKeyDown={rowKeydown((rect) => {
                    handleProjectMenu(project, { x: rect.left + rect.width / 2, y: rect.bottom });
                  })}
                >
                  {projectCollapsed ? (
                    <ChevronRightIcon className="size-3.5 shrink-0" />
                  ) : (
                    <ChevronDownIcon className="size-3.5 shrink-0" />
                  )}
                  <FolderIcon className="size-3.5 shrink-0 text-sidebar-muted-foreground" />
                  <span className="min-w-0 flex-1 truncate">{project.title}</span>
                </button>
                {!projectCollapsed ? (
                  <div className="ms-4 flex flex-col gap-px border-s border-sidebar-border ps-1.5">
                    {project.workspaces.map((workspace) => {
                      const workspaceKey = `${project.environmentId}:${workspace.id}`;
                      const workspaceExpanded = expandedWorkspaces.has(workspaceKey);
                      const activeSessions = workspace.sessions ?? [];
                      const historySessions = workspace.historySessions ?? [];
                      return (
                        <div key={workspaceKey} className="flex flex-col gap-px">
                          <div className="flex items-center gap-1">
                            <button
                              type="button"
                              data-testid="sidebar-workspace-disclosure"
                              aria-label={
                                workspaceExpanded ? "Collapse Workspace" : "Expand Workspace"
                              }
                              className="flex size-5 shrink-0 items-center justify-center rounded hover:bg-sidebar-row-hover"
                              onClick={() => toggleWorkspaceExpanded(workspaceKey)}
                            >
                              {workspaceExpanded ? (
                                <ChevronDownIcon className="size-3" />
                              ) : (
                                <ChevronRightIcon className="size-3" />
                              )}
                            </button>
                            <button
                              type="button"
                              data-testid="sidebar-workspace-row"
                              data-environment-connected={connectedEnvironmentIds.has(
                                project.environmentId,
                              )}
                              role="treeitem"
                              className="flex min-h-7 min-w-0 flex-1 items-center gap-1.5 rounded-md px-2 text-left text-xs text-sidebar-muted-foreground hover:bg-sidebar-row-hover hover:text-sidebar-foreground"
                              onClick={() => toggleWorkspaceExpanded(workspaceKey)}
                              onContextMenu={(event) => {
                                event.preventDefault();
                                event.stopPropagation();
                                handleWorkspaceMenu(project, workspace, {
                                  x: event.clientX,
                                  y: event.clientY,
                                });
                              }}
                              onKeyDown={rowKeydown((rect) => {
                                handleWorkspaceMenu(project, workspace, {
                                  x: rect.left + rect.width / 2,
                                  y: rect.bottom,
                                });
                              })}
                            >
                              <GitBranchIcon className="size-3 shrink-0" />
                              <span className="min-w-0 flex-1 truncate">{workspace.title}</span>
                              <span className="shrink-0 text-[10px] uppercase opacity-60">
                                {workspace.role}
                              </span>
                            </button>
                          </div>
                          {workspaceExpanded ? (
                            <div className="ms-4 flex flex-col gap-px border-s border-sidebar-border ps-1.5">
                              {activeSessions.map((session) => {
                                if (session.kind === "agent") {
                                  return (
                                    <SessionRow
                                      key={session.id}
                                      data-testid="sidebar-session-row"
                                      data-session-kind="agent"
                                      sessionTitle={session.title}
                                      target={{
                                        kind: "agentSession",
                                        environmentId: project.environmentId,
                                        workspaceId: workspace.id,
                                        agentSessionId: session.id,
                                      }}
                                      onStartRename={() =>
                                        renameAgent(
                                          project.environmentId,
                                          session.threadId,
                                          session.title,
                                        )
                                      }
                                      navigateTo={(route) =>
                                        void navigate({ ...route, to: route.to as never } as never)
                                      }
                                    >
                                      <span className="min-w-0 flex-1 truncate">
                                        {session.title}
                                      </span>
                                    </SessionRow>
                                  );
                                }
                                return (
                                  <SessionRow
                                    key={session.id}
                                    data-testid="sidebar-session-row"
                                    data-session-kind="terminal"
                                    sessionTitle={session.title}
                                    target={{
                                      kind: "workspaceTerminal",
                                      environmentId: project.environmentId,
                                      workspaceId: workspace.id,
                                      terminalSessionId: session.id,
                                    }}
                                    navigateTo={(route) =>
                                      void navigate({ ...route, to: route.to as never } as never)
                                    }
                                    onStartRename={() =>
                                      renameTerminal(
                                        {
                                          kind: "workspaceTerminal",
                                          environmentId: project.environmentId,
                                          workspaceId: workspace.id,
                                          terminalSessionId: session.id,
                                        },
                                        session.title,
                                      )
                                    }
                                  >
                                    <TerminalIcon className="size-3 shrink-0" />
                                    <span className="min-w-0 flex-1 truncate">{session.title}</span>
                                    <span className="shrink-0 text-[10px] opacity-60">
                                      {session.status}
                                    </span>
                                  </SessionRow>
                                );
                              })}
                              {historySessions.length > 0 ? (
                                <button
                                  type="button"
                                  data-testid="sidebar-history-toggle"
                                  className="flex min-h-6 items-center gap-1 rounded-md px-2 text-left text-[10px] text-sidebar-muted-foreground hover:bg-sidebar-row-hover"
                                  onClick={() =>
                                    setHistoryExpanded((current) => {
                                      const next = new Set(current);
                                      if (next.has(workspaceKey)) next.delete(workspaceKey);
                                      else next.add(workspaceKey);
                                      return next;
                                    })
                                  }
                                >
                                  {historyExpanded.has(workspaceKey) ? (
                                    <ChevronDownIcon className="size-3" />
                                  ) : (
                                    <ChevronRightIcon className="size-3" />
                                  )}
                                  History ({historySessions.length})
                                </button>
                              ) : null}
                              {historyExpanded.has(workspaceKey)
                                ? historySessions.map((session) =>
                                    session.kind === "agent" ? (
                                      <SessionRow
                                        key={session.id}
                                        data-testid="sidebar-session-row"
                                        data-session-kind="agent"
                                        data-session-closed="true"
                                        isClosed
                                        sessionTitle={session.title}
                                        target={{
                                          kind: "agentSession",
                                          environmentId: project.environmentId,
                                          workspaceId: workspace.id,
                                          agentSessionId: session.id,
                                        }}
                                        onStartRename={() =>
                                          renameAgent(
                                            project.environmentId,
                                            session.threadId,
                                            session.title,
                                          )
                                        }
                                        navigateTo={(route) =>
                                          void navigate({
                                            ...route,
                                            to: route.to as never,
                                          } as never)
                                        }
                                      >
                                        <span className="min-w-0 flex-1 truncate">
                                          {session.title}
                                        </span>
                                      </SessionRow>
                                    ) : (
                                      <SessionRow
                                        key={session.id}
                                        data-testid="sidebar-session-row"
                                        data-session-kind="terminal"
                                        data-session-closed="true"
                                        isClosed
                                        sessionTitle={session.title}
                                        target={{
                                          kind: "workspaceTerminal",
                                          environmentId: project.environmentId,
                                          workspaceId: workspace.id,
                                          terminalSessionId: session.id,
                                        }}
                                        navigateTo={(route) =>
                                          void navigate({
                                            ...route,
                                            to: route.to as never,
                                          } as never)
                                        }
                                        onStartRename={() =>
                                          renameTerminal(
                                            {
                                              kind: "workspaceTerminal",
                                              environmentId: project.environmentId,
                                              workspaceId: workspace.id,
                                              terminalSessionId: session.id,
                                            },
                                            session.title,
                                          )
                                        }
                                      >
                                        <TerminalIcon className="size-3 shrink-0" />
                                        <span className="min-w-0 flex-1 truncate">
                                          {session.title}
                                        </span>
                                      </SessionRow>
                                    ),
                                  )
                                : null}
                            </div>
                          ) : null}
                        </div>
                      );
                    })}
                  </div>
                ) : null}
              </div>
            );
          })}
        </div>
      </SidebarGroup>
    </SidebarContent>
  );
}
