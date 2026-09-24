import { describe, expect, it } from "vite-plus/test";

import {
  isRemoteEnvironmentTarget,
  projectDeleteInputs,
  projectMenuItems,
  workspaceMenuItems,
} from "./AwenSidebar";
import type { EnvironmentAwenProject } from "@awen/client-runtime/state/models";
import type { ConnectionTarget } from "@awen/client-runtime/connection";

const project = {
  id: "awen-project",
  environmentId: "local",
  title: "Project",
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
  workspaces: [
    {
      id: "workspace-main",
      projectId: "awen-project",
      awenProjectId: "awen-project-main",
      title: "Main",
      workspaceRoot: "/repo",
      role: "main",
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z",
    },
    {
      id: "workspace-worktree",
      projectId: "awen-project",
      awenProjectId: "awen-project-worktree",
      title: "Worktree",
      workspaceRoot: "/repo-worktree",
      role: "worktree",
      origin: "awen-created",
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z",
    },
  ],
} as unknown as EnvironmentAwenProject;

describe("Awen Sidebar menus", () => {
  it("force-deletes every backing Awen project after the user confirms project removal", () => {
    expect(projectDeleteInputs(project)).toEqual([
      { environmentId: "local", input: { projectId: "awen-project-main", force: true } },
      { environmentId: "local", input: { projectId: "awen-project-worktree", force: true } },
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
      "review-changes",
      "new-agent-session",
      "new-terminal-session",
      "rename-workspace",
      "remove-workspace",
      "delete-directory",
    ]);
  });

  it("only exposes directory deletion for Workspaces Awen created", () => {
    expect(workspaceMenuItems({ canDeleteDirectory: false }).map((item) => item.id)).not.toContain(
      "delete-directory",
    );
  });
});

describe("remote project icon classification", () => {
  const target = (value: object) => value as ConnectionTarget;

  it("treats SSH and bearer targets as remote", () => {
    expect(
      isRemoteEnvironmentTarget(
        target({ _tag: "SshConnectionTarget", connectionId: "ssh:devbox" }),
      ),
    ).toBe(true);
    expect(
      isRemoteEnvironmentTarget(
        target({ _tag: "BearerConnectionTarget", connectionId: "pairing:abc" }),
      ),
    ).toBe(true);
  });

  it("keeps the primary and desktop-local backends local", () => {
    expect(isRemoteEnvironmentTarget(target({ _tag: "PrimaryConnectionTarget" }))).toBe(false);
    expect(
      isRemoteEnvironmentTarget(
        target({ _tag: "BearerConnectionTarget", connectionId: "local:wsl:Ubuntu" }),
      ),
    ).toBe(false);
  });
});
