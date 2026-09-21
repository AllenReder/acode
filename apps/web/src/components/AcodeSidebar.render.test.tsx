import { act } from "react";
import { create, type ReactTestRenderer } from "react-test-renderer";
import { afterEach, describe, expect, it, vi } from "vite-plus/test";

const mockState = {
  projects: [] as any[],
  environments: [] as any[],
  navigate: vi.fn(),
};

vi.mock("@tanstack/react-router", () => ({
  useNavigate: () => mockState.navigate,
  useCanGoBack: () => true,
  useLocation: ({ select }: { select: (location: { pathname: string }) => unknown }) =>
    select({ pathname: "/" }),
}));

vi.mock("@effect/atom-react", () => ({
  useAtomValue: () => new Map(),
  useAtomRefresh: () => vi.fn(),
}));

vi.mock("../state/entities", () => ({
  useAcodeProjects: () => mockState.projects,
  useAcodeAgentSessionShell: () => null,
  readThreadShell: () => null,
}));

vi.mock("../state/environments", () => ({
  useEnvironments: () => ({ environments: mockState.environments }),
}));

vi.mock("../state/use-atom-command", () => ({
  useAtomCommand: () => vi.fn().mockResolvedValue({ _tag: "Success" }),
}));

vi.mock("./ui/sidebar", () => ({
  SidebarContent: ({ children }: any) => <div data-sidebar="content">{children}</div>,
  SidebarGroup: ({ children }: any) => <div data-sidebar="group">{children}</div>,
  SidebarGroupLabel: ({ children }: any) => <div data-sidebar="group-label">{children}</div>,
  SidebarHeader: ({ children }: any) => <header data-sidebar="header">{children}</header>,
  SidebarFooter: ({ children, className, ...props }: any) => (
    <footer className={className} data-sidebar="footer" {...props}>
      {children}
    </footer>
  ),
  SidebarMenu: ({ children }: any) => <ul>{children}</ul>,
  SidebarMenuItem: ({ children }: any) => <li>{children}</li>,
  SidebarMenuButton: ({ children, onClick, ...props }: any) => (
    <button type="button" onClick={onClick} {...props}>
      {children}
    </button>
  ),
  useSidebar: () => ({ isMobile: false, setOpenMobile: vi.fn(), toggleSidebar: vi.fn(), open: true }),
  useSidebarVisibility: () => true,
}));

vi.mock("./ui/tooltip", () => ({
  Tooltip: ({ children }: any) => <>{children}</>,
  TooltipTrigger: ({ render }: any) => render,
  TooltipPopup: ({ children, ...props }: any) => <div {...props}>{children}</div>,
}));

vi.mock("./sidebar/SidebarProviderUpdatePill", () => ({
  SidebarProviderUpdatePill: () => null,
}));

vi.mock("./sidebar/SidebarUpdatePill", () => ({
  SidebarUpdateArchitectureWarning: () => null,
  SidebarUpdatePill: () => null,
}));

vi.mock("./SidebarStageBackdrop", () => ({
  useEnvironmentStageLabel: () => null,
  resolveEnvironmentIdentificationPillLabel: () => null,
}));

vi.mock("../hooks/useSettings", () => ({
  useEnvironmentIdentificationMode: () => "none",
}));

import { AcodeSidebar } from "./AcodeSidebar";

describe("AcodeSidebar", () => {
  let renderer: ReactTestRenderer;

  afterEach(async () => {
    await act(() => renderer?.unmount());
    vi.clearAllMocks();
    mockState.projects = [];
  });

  it("renders the sidebar header and add project button when there are no projects", async () => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    mockState.projects = [];

    await act(() => {
      renderer = create(<AcodeSidebar />);
    });

    const addProjectBtn = renderer.root.findByProps({ "data-testid": "sidebar-add-project" });
    expect(addProjectBtn).toBeDefined();

    const header = renderer.root.findByProps({ "data-sidebar": "header" });
    expect(header).toBeDefined();
  });

  it("renders the sidebar header and project list when projects exist", async () => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    mockState.projects = [
      {
        id: "p1",
        environmentId: "local",
        title: "Test Project",
        workspaces: [],
      },
    ];

    await act(() => {
      renderer = create(<AcodeSidebar />);
    });

    const projectRow = renderer.root.findByProps({ "data-testid": "sidebar-project-row" });
    expect(projectRow).toBeDefined();

    const header = renderer.root.findByProps({ "data-sidebar": "header" });
    expect(header).toBeDefined();
  });

  it("renders active sessions sorted according to workspaceSessionOrderById", async () => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    const { useUiStateStore } = await import("../uiStateStore");

    mockState.projects = [
      {
        id: "p1",
        environmentId: "local",
        title: "Test Project",
        workspaces: [
          {
            id: "w1",
            title: "Main Workspace",
            role: "main",
            sessions: [
              { kind: "agent", id: "s1", title: "Session One" },
              { kind: "agent", id: "s2", title: "Session Two" },
              { kind: "agent", id: "s3", title: "Session Three" },
            ],
          },
        ],
      },
    ];

    // Set custom order: s3, s1, s2
    act(() => {
      useUiStateStore.setState({
        workspaceSessionOrderById: {
          "local:w1": ["s3", "s1", "s2"],
        },
      });
    });

    await act(() => {
      renderer = create(<AcodeSidebar />);
    });

    // Expand workspace
    const workspaceRow = renderer.root.findByProps({ "data-testid": "sidebar-workspace-row" });
    await act(() => {
      workspaceRow.props.onClick();
    });

    const sessionRows = renderer.root.findAllByProps({ "data-sidebar-session-row": "true" });
    expect(sessionRows).toHaveLength(3);
    expect(sessionRows.map((r) => r.props["data-session-id"])).toEqual([
      "s3",
      "s1",
      "s2",
    ]);
  });
});
