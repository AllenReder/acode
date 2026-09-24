import { act, type ReactNode } from "react";
import { create, type ReactTestRenderer } from "react-test-renderer";
import { afterEach, describe, expect, it, vi } from "vite-plus/test";

const pickFolderMock = vi.fn<() => Promise<string | null>>().mockResolvedValue("/custom/path");

vi.mock("../../localApi", () => ({
  readLocalApi: () => ({
    dialogs: { pickFolder: pickFolderMock },
  }),
}));

vi.mock("../ui/dialog", () => ({
  Dialog: ({ open, children }: { open: boolean; children: ReactNode }) =>
    open ? <>{children}</> : null,
  DialogDescription: ({ children }: { children: ReactNode }) => <p>{children}</p>,
  DialogFooter: ({ children }: { children: ReactNode }) => <footer>{children}</footer>,
  DialogHeader: ({ children }: { children: ReactNode }) => <header>{children}</header>,
  DialogPanel: ({ children }: { children: ReactNode }) => <section>{children}</section>,
  DialogPopup: ({ children, ...props }: { children: ReactNode }) => (
    <div {...props}>{children}</div>
  ),
  DialogTitle: ({ children }: { children: ReactNode }) => <h2>{children}</h2>,
}));

const mockRefs = [
  { name: "main", isDefault: true, current: true, worktreePath: "/repo/main" },
  { name: "feature-worktree", isDefault: false, current: false, worktreePath: "/repo/wt-feat" },
  { name: "release-branch", isDefault: false, current: false, worktreePath: null },
];

vi.mock("../../state/query", () => ({
  useEnvironmentQuery: (atom: unknown) => ({
    data: atom ? { refs: mockRefs } : null,
    error: null,
    isPending: false,
    isSuccess: true,
    refresh: vi.fn(),
  }),
}));

import { AddWorkspaceDialog, NewWorkspaceDialog } from "./WorkspaceDialogs";
import type { EnvironmentAwenProject } from "@awen/client-runtime/state/models";

const mockProject = {
  id: "project-1",
  environmentId: "local",
  title: "My Project",
  workspaces: [
    {
      id: "w-main",
      projectId: "project-1",
      awenProjectId: "awen-main",
      title: "main",
      workspaceRoot: "/repo/main",
      role: "main",
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z",
    },
  ],
} as unknown as EnvironmentAwenProject;

describe("WorkspaceDialogs", () => {
  let renderer: ReactTestRenderer;

  afterEach(async () => {
    await act(() => renderer?.unmount());
    vi.clearAllMocks();
  });

  describe("AddWorkspaceDialog", () => {
    it("renders dialog with project title when open", async () => {
      vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
      const onAssociate = vi.fn().mockResolvedValue(undefined);
      const onOpenChange = vi.fn();

      await act(() => {
        renderer = create(
          <AddWorkspaceDialog
            project={mockProject}
            open={true}
            onOpenChange={onOpenChange}
            onAssociate={onAssociate}
          />,
        );
      });

      const dialog = renderer.root.findByProps({ "data-testid": "add-workspace-dialog" });
      expect(dialog).toBeDefined();

      const input = renderer.root.findByProps({ "data-testid": "add-workspace-path-input" });
      expect(input.props.value).toBe("");
    });

    it("displays existing worktrees in repository and selects one on click", async () => {
      vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
      const onAssociate = vi.fn().mockResolvedValue(undefined);
      const onOpenChange = vi.fn();

      await act(() => {
        renderer = create(
          <AddWorkspaceDialog
            project={mockProject}
            open={true}
            onOpenChange={onOpenChange}
            onAssociate={onAssociate}
          />,
        );
      });

      const wtItem = renderer.root.findByProps({
        "data-testid": "existing-worktree-item-feature-worktree",
      });
      expect(wtItem).toBeDefined();

      await act(() => {
        wtItem.props.onClick();
      });

      const input = renderer.root.findByProps({ "data-testid": "add-workspace-path-input" });
      expect(input.props.value).toBe("/repo/wt-feat");
    });

    it("handles typing and submitting worktree path", async () => {
      vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
      const onAssociate = vi.fn().mockResolvedValue(undefined);
      const onOpenChange = vi.fn();

      await act(() => {
        renderer = create(
          <AddWorkspaceDialog
            project={mockProject}
            open={true}
            onOpenChange={onOpenChange}
            onAssociate={onAssociate}
          />,
        );
      });

      const input = renderer.root.findByProps({ "data-testid": "add-workspace-path-input" });
      await act(() => {
        input.props.onChange({ target: { value: "/my/worktree/path" } });
      });

      const form = renderer.root.findByType("form");
      await act(() => {
        form.props.onSubmit({ preventDefault: () => {} });
      });

      expect(onAssociate).toHaveBeenCalledWith("/my/worktree/path");
      expect(onOpenChange).toHaveBeenCalledWith(false);
    });

    it("supports folder picking via Browse button", async () => {
      vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
      const onAssociate = vi.fn().mockResolvedValue(undefined);
      const onOpenChange = vi.fn();

      await act(() => {
        renderer = create(
          <AddWorkspaceDialog
            project={mockProject}
            open={true}
            onOpenChange={onOpenChange}
            onAssociate={onAssociate}
          />,
        );
      });

      const browseBtn = renderer.root.findByProps({ "data-testid": "add-workspace-browse-btn" });
      await act(async () => {
        await browseBtn.props.onClick();
      });

      expect(pickFolderMock).toHaveBeenCalled();
      const input = renderer.root.findByProps({ "data-testid": "add-workspace-path-input" });
      expect(input.props.value).toBe("/custom/path");
    });
  });

  describe("NewWorkspaceDialog", () => {
    it("renders dialog with default base ref HEAD when open", async () => {
      vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
      const onCreate = vi.fn().mockResolvedValue(undefined);
      const onOpenChange = vi.fn();

      await act(() => {
        renderer = create(
          <NewWorkspaceDialog
            project={mockProject}
            open={true}
            onOpenChange={onOpenChange}
            onCreate={onCreate}
          />,
        );
      });

      const dialog = renderer.root.findByProps({ "data-testid": "new-workspace-dialog" });
      expect(dialog).toBeDefined();

      const branchInput = renderer.root.findByProps({
        "data-testid": "new-workspace-branch-input",
      });
      expect(branchInput.props.value).toBe("");

      const baseRefInput = renderer.root.findByProps({
        "data-testid": "new-workspace-base-ref-input",
      });
      expect(baseRefInput.props.value).toBe("");
      expect(baseRefInput.props.placeholder).toBe("HEAD");
    });

    it("opens refs dropdown on click and filters refs by input", async () => {
      vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
      const onCreate = vi.fn().mockResolvedValue(undefined);
      const onOpenChange = vi.fn();

      await act(() => {
        renderer = create(
          <NewWorkspaceDialog
            project={mockProject}
            open={true}
            onOpenChange={onOpenChange}
            onCreate={onCreate}
          />,
        );
      });

      const baseRefInput = renderer.root.findByProps({
        "data-testid": "new-workspace-base-ref-input",
      });

      await act(() => {
        baseRefInput.props.onClick();
      });

      const dropdown = renderer.root.findByProps({
        "data-testid": "new-workspace-base-ref-dropdown",
      });
      expect(dropdown).toBeDefined();

      // Type "release"
      await act(() => {
        baseRefInput.props.onChange({ target: { value: "release" } });
      });

      const releaseOption = renderer.root.findByProps({
        "data-testid": "base-ref-option-release-branch",
      });
      expect(releaseOption).toBeDefined();

      // Click option to select it
      await act(() => {
        releaseOption.props.onMouseDown({ preventDefault: () => {} });
      });

      expect(baseRefInput.props.value).toBe("release-branch");
    });

    it("submits configured branch and baseRef", async () => {
      vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
      const onCreate = vi.fn().mockResolvedValue(undefined);
      const onOpenChange = vi.fn();

      await act(() => {
        renderer = create(
          <NewWorkspaceDialog
            project={mockProject}
            open={true}
            onOpenChange={onOpenChange}
            onCreate={onCreate}
          />,
        );
      });

      const branchInput = renderer.root.findByProps({
        "data-testid": "new-workspace-branch-input",
      });
      await act(() => {
        branchInput.props.onChange({ target: { value: "feat-test" } });
      });

      const form = renderer.root.findByType("form");
      await act(() => {
        form.props.onSubmit({ preventDefault: () => {} });
      });

      expect(onCreate).toHaveBeenCalledWith({
        newBranch: "feat-test",
      });
      expect(onOpenChange).toHaveBeenCalledWith(false);
    });
  });
});
