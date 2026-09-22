import { act, create, type ReactTestRenderer } from "react-test-renderer";
import { describe, expect, it, vi } from "vite-plus/test";
import { EnvironmentId, ProjectId, ThreadId, type ResolvedKeybindingsConfig } from "@t3tools/contracts";
import type { EnvironmentProject } from "@t3tools/client-runtime/state/shell";
import type { ReactNode } from "react";
import { ChatHeader } from "./ChatHeader";

const doc = {
  nodeType: 9,
  documentElement: { style: {} },
  createElement: () => ({ style: {} }),
  addEventListener() {},
  removeEventListener() {},
};
vi.stubGlobal("document", doc);
vi.stubGlobal("window", {
  document: doc,
  addEventListener() {},
  removeEventListener() {},
  matchMedia: () => ({ matches: false, addEventListener() {}, removeEventListener() {} }),
});

vi.mock("../../panelAnimations", () => ({
  usePanelAnimationSettings: () => ({ active: false, durationMs: 0 }),
  observeResponsiveBreakpointFade: () => () => {},
}));
vi.mock("../../state/environments", () => ({
  usePrimaryEnvironmentId: () => "primary-env",
}));
vi.mock("~/hooks/useT3ProjectFileScripts", () => ({
  useT3ProjectFileScripts: () => undefined,
}));
vi.mock("../../remoteOpen", () => ({
  useRemoteOpenState: () => ({ mode: "local-exec" }),
}));
vi.mock("../../state/use-atom-command", () => ({
  useAtomCommand: () => vi.fn(),
}));
vi.mock("~/hooks/useThreadActionMenu", () => ({
  useThreadActionMenu: () => ({ openMenu: vi.fn(), closeMenu: vi.fn() }),
}));
vi.mock("../GitActionsControl", () => ({
  default: () => <div data-testid="git-actions" />,
}));
vi.mock("../ProjectScriptsControl", () => ({
  default: () => <div data-testid="project-scripts" />,
}));
vi.mock("./OpenInPicker", () => ({
  OpenInPicker: () => <div data-testid="open-in-picker" />,
}));
vi.mock("../ProjectFavicon", () => ({
  ProjectFavicon: () => <div data-testid="project-favicon" />,
}));
vi.mock("../ui/tooltip", () => ({
  Tooltip: ({ children }: { readonly children?: ReactNode }) => <>{children}</>,
  TooltipTrigger: ({ render, children }: { readonly render?: ReactNode; readonly children?: ReactNode }) => render ?? <>{children}</>,
  TooltipPopup: ({ children }: { readonly children?: ReactNode }) => <>{children}</>,
}));
vi.mock("../ui/menu", () => ({
  Menu: ({ children }: { readonly children?: ReactNode }) => <>{children}</>,
  MenuTrigger: ({ render, children }: { readonly render?: ReactNode; readonly children?: ReactNode }) => render ?? <>{children}</>,
  MenuPopup: ({ children }: { readonly children?: ReactNode }) => <>{children}</>,
  MenuItem: ({ onClick, children }: { readonly onClick?: () => void; readonly children?: ReactNode }) => (
    <button type="button" onClick={onClick}>{children}</button>
  ),
}));

describe("ChatHeader in workbenchMode", () => {
  const activeProject: EnvironmentProject = {
    environmentId: EnvironmentId.make("env-1"),
    id: ProjectId.make("p1"),
    title: "My Project",
    workspaceRoot: "/root",
    defaultModelSelection: null,
    scripts: [],
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
  };
  const keybindings: ResolvedKeybindingsConfig = [];
  const defaultProps = {
    activeThreadEnvironmentId: EnvironmentId.make("env-1"),
    activeThreadId: ThreadId.make("thread-1"),
    activeThreadTitle: "Session 1",
    isServerThread: true,
    activeProject,
    openInCwd: "/root",
    activeProjectScripts: undefined,
    preferredScriptId: null,
    keybindings,
    availableEditors: [],
    rightPanelOpen: false,
    gitCwd: "/root",
    onNewThreadInProject: vi.fn(),
    onRunProjectScript: vi.fn(),
    onAddProjectScript: vi.fn(),
    onUpdateProjectScript: vi.fn(),
    onDeleteProjectScript: vi.fn(),
  };

  it("hides project breadcrumbs and renders static session title when workbenchMode is true", () => {
    let renderer: ReactTestRenderer | null = null;
    act(() => {
      renderer = create(<ChatHeader {...defaultProps} workbenchMode={true} />);
    });

    const root = renderer!.root;
    // Project breadcrumb should not be rendered
    expect(root.findAllByProps({ "aria-label": "New thread in My Project" })).toHaveLength(0);

    // Title should be static h2, not button with menu
    const titleH2 = root.findByProps({ "aria-label": "Session 1" });
    expect(titleH2.type).toBe("h2");
    expect(root.findAllByProps({ "data-thread-title-chevron": true })).toHaveLength(0);
  });

  it("renders new terminal session button and workspace views menu when handlers are provided in workbenchMode", () => {
    const onBrowseFiles = vi.fn();
    const onNewTerminalSession = vi.fn();

    let renderer: ReactTestRenderer | null = null;
    act(() => {
      renderer = create(
        <ChatHeader
          {...defaultProps}
          workbenchMode={true}
          onBrowseFiles={onBrowseFiles}
          onNewTerminalSession={onNewTerminalSession}
        />,
      );
    });

    const root = renderer!.root;
    const terminalButton = root.findByProps({ "aria-label": "New terminal session" });
    expect(terminalButton).toBeDefined();
    expect(terminalButton.props.variant).toBe("outline");
    expect(terminalButton.props.size).toBe("xs");
    act(() => {
      terminalButton.props.onClick();
    });
    expect(onNewTerminalSession).toHaveBeenCalledTimes(1);

    const viewsMenuTrigger = root.findByProps({ "aria-label": "Workspace views" });
    expect(viewsMenuTrigger).toBeDefined();
    expect(viewsMenuTrigger.props.variant).toBe("outline");
    expect(viewsMenuTrigger.props.size).toBe("icon-xs");
  });
});
