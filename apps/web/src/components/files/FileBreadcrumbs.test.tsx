import { act } from "react";
import { create, type ReactTestRenderer } from "react-test-renderer";
import { afterEach, describe, expect, it, vi } from "vite-plus/test";
import type { EnvironmentId } from "@awen/contracts";

import { FileBreadcrumbs } from "./FileBreadcrumbs";

vi.mock("./projectFilesQueryState", () => ({
  useProjectEntriesQuery: () => ({ data: null, isPending: false, error: null, refresh: vi.fn() }),
}));

vi.mock("~/components/ui/tooltip", () => ({
  Tooltip: ({ children }: any) => <>{children}</>,
  TooltipTrigger: ({ render }: any) => render,
  TooltipPopup: ({ children, ...props }: any) => <div {...props}>{children}</div>,
}));
vi.mock("~/components/ui/menu", () => ({
  Menu: ({ children }: any) => <>{children}</>,
  MenuTrigger: ({ render }: any) => render,
  MenuPopup: ({ children, ...props }: any) => <div {...props}>{children}</div>,
  MenuGroup: ({ children }: any) => <>{children}</>,
  MenuItem: ({ children, ...props }: any) => <div {...props}>{children}</div>,
  MenuSeparator: () => null,
}));

vi.mock("~/hooks/useTheme", () => ({
  useTheme: () => ({ resolvedTheme: "dark" }),
}));

vi.mock("~/hooks/useWorkspaceMutationRefresh", () => ({
  useWorkspaceMutationRefresh: vi.fn(),
}));

let renderer: ReactTestRenderer;

afterEach(async () => {
  await act(() => renderer?.unmount());
  vi.clearAllMocks();
  vi.unstubAllGlobals();
});

describe("FileBreadcrumbs", () => {
  it("renders dirty indicator when isDirty is true", async () => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);

    await act(() => {
      renderer = create(
        <FileBreadcrumbs
          cwd="/workspace"
          environmentId={"local" as EnvironmentId}
          projectName="Project"
          relativePath="src/main.ts"
          onOpenFile={vi.fn()}
          workspaceMutationId={null}
          isDirty={true}
        />,
      );
    });

    const dirtyIndicator = renderer.root.findAllByProps({ "data-testid": "file-dirty-indicator" });
    expect(dirtyIndicator).toHaveLength(1);
  });

  it("does not render dirty indicator when isDirty is false", async () => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);

    await act(() => {
      renderer = create(
        <FileBreadcrumbs
          cwd="/workspace"
          environmentId={"local" as EnvironmentId}
          projectName="Project"
          relativePath="src/main.ts"
          onOpenFile={vi.fn()}
          workspaceMutationId={null}
          isDirty={false}
        />,
      );
    });

    const dirtyIndicator = renderer.root.findAllByProps({ "data-testid": "file-dirty-indicator" });
    expect(dirtyIndicator).toHaveLength(0);
  });
});
