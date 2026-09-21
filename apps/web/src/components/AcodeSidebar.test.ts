import { describe, expect, it } from "vite-plus/test";

import { projectDeleteInputs, projectMenuItems, workspaceMenuItems } from "./AcodeSidebar";
import type { EnvironmentAcodeProject } from "@t3tools/client-runtime/state/models";

const project = {
  id: "acode-project",
  environmentId: "local",
  title: "Project",
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
  workspaces: [
    {
      id: "workspace-main",
      projectId: "acode-project",
      t3ProjectId: "t3-project-main",
      title: "Main",
      workspaceRoot: "/repo",
      role: "main",
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z",
    },
    {
      id: "workspace-worktree",
      projectId: "acode-project",
      t3ProjectId: "t3-project-worktree",
      title: "Worktree",
      workspaceRoot: "/repo-worktree",
      role: "worktree",
      origin: "acode-created",
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z",
    },
  ],
} as unknown as EnvironmentAcodeProject;

describe("ACode Sidebar menus", () => {
  it("force-deletes every backing T3 project after the user confirms project removal", () => {
    expect(projectDeleteInputs(project)).toEqual([
      { environmentId: "local", input: { projectId: "t3-project-main", force: true } },
      { environmentId: "local", input: { projectId: "t3-project-worktree", force: true } },
    ]);
  });

  it("exposes project management and Workspace creation actions", () => {
    expect(projectMenuItems({ canManageWorkspaces: true }).map((item) => item.id)).toEqual([
      "add-workspace",
      "new-workspace",
      "rename-project",
      "remove-project",
    ]);
    expect(workspaceMenuItems({ canDeleteDirectory: true }).map((item) => item.id)).toEqual([
      "browse-files",
      "new-agent-session",
      "new-terminal-session",
      "rename-workspace",
      "remove-workspace",
      "delete-directory",
    ]);
  });

  it("only exposes directory deletion for Workspaces ACode created", () => {
    expect(workspaceMenuItems({ canDeleteDirectory: false }).map((item) => item.id)).not.toContain(
      "delete-directory",
    );
  });
});
