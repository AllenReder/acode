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
}));

vi.mock("../state/entities", () => ({
  useAcodeProjects: () => mockState.projects,
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
  useSidebar: () => ({ isMobile: false, setOpenMobile: vi.fn() }),
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

import { AcodeSidebar } from "./AcodeSidebar";

describe("AcodeSidebar with footer", () => {
  let renderer: ReactTestRenderer;

  afterEach(async () => {
    await act(() => renderer?.unmount());
    vi.clearAllMocks();
    mockState.projects = [];
  });

  it("renders the sidebar footer with settings button when there are no projects", async () => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    mockState.projects = [];

    await act(() => {
      renderer = create(<AcodeSidebar />);
    });

    const footer = renderer.root.findByProps({ "data-testid": "sidebar-footer" });
    expect(footer).toBeDefined();

    const settingsButton = renderer.root.findByProps({ "data-testid": "sidebar-settings-button" });
    expect(settingsButton).toBeDefined();

    await act(() => {
      settingsButton.props.onClick();
    });

    expect(mockState.navigate).toHaveBeenCalledWith({ to: "/settings" });
  });

  it("renders the sidebar footer with settings button when projects exist", async () => {
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

    const footer = renderer.root.findByProps({ "data-testid": "sidebar-footer" });
    expect(footer).toBeDefined();

    const settingsButton = renderer.root.findByProps({ "data-testid": "sidebar-settings-button" });
    expect(settingsButton).toBeDefined();
  });
});
