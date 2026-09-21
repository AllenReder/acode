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
  Dialog: ({ open, children }: { open: boolean; children: ReactNode }) => (open ? <>{children}</> : null),
  DialogDescription: ({ children }: { children: ReactNode }) => <p>{children}</p>,
  DialogFooter: ({ children }: { children: ReactNode }) => <footer>{children}</footer>,
  DialogHeader: ({ children }: { children: ReactNode }) => <header>{children}</header>,
  DialogPanel: ({ children }: { children: ReactNode }) => <section>{children}</section>,
  DialogPopup: ({ children, ...props }: { children: ReactNode }) => <div {...props}>{children}</div>,
  DialogTitle: ({ children }: { children: ReactNode }) => <h2>{children}</h2>,
}));

import { AddWorkspaceDialog, NewWorkspaceDialog } from "./WorkspaceDialogs";
import type { EnvironmentAcodeProject } from "@t3tools/client-runtime/state/models";

const mockProject = {
  id: "project-1",
  environmentId: "local",
  title: "My Project",
  workspaces: [],
} as unknown as EnvironmentAcodeProject;

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

      const branchInput = renderer.root.findByProps({ "data-testid": "new-workspace-branch-input" });
      expect(branchInput.props.value).toBe("");

      const baseRefInput = renderer.root.findByProps({ "data-testid": "new-workspace-base-ref-input" });
      expect(baseRefInput.props.value).toBe("HEAD");
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

      const branchInput = renderer.root.findByProps({ "data-testid": "new-workspace-branch-input" });
      await act(() => {
        branchInput.props.onChange({ target: { value: "feat-test" } });
      });

      const form = renderer.root.findByType("form");
      await act(() => {
        form.props.onSubmit({ preventDefault: () => {} });
      });

      expect(onCreate).toHaveBeenCalledWith({
        newBranch: "feat-test",
        baseRef: "HEAD",
        path: undefined,
      });
      expect(onOpenChange).toHaveBeenCalledWith(false);
    });
  });
});
