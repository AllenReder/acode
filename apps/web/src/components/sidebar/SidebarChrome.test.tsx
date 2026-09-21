import { act } from "react";
import { create, type ReactTestRenderer } from "react-test-renderer";
import { afterEach, describe, expect, it, vi } from "vite-plus/test";

const routerState = {
  pathname: "/",
  navigate: vi.fn(),
  canGoBack: true,
};

vi.mock("@tanstack/react-router", () => ({
  useNavigate: () => routerState.navigate,
  useCanGoBack: () => routerState.canGoBack,
  useLocation: ({ select }: { select: (location: { pathname: string }) => unknown }) =>
    select({ pathname: routerState.pathname }),
}));

vi.mock("../../state/environments", () => ({
  useEnvironments: () => ({ environments: [] }),
}));

vi.mock("../../hooks/useSettings", () => ({
  useEnvironmentIdentificationMode: () => "none",
}));

vi.mock("../SidebarStageBackdrop", () => ({
  useEnvironmentStageLabel: () => null,
  resolveEnvironmentIdentificationPillLabel: () => null,
}));

vi.mock("../ui/sidebar", () => ({
  SidebarFooter: ({ children, className, ...props }: any) => (
    <footer className={className} data-sidebar="footer" {...props}>
      {children}
    </footer>
  ),
  SidebarHeader: ({ children, ...props }: any) => <header {...props}>{children}</header>,
  SidebarMenu: ({ children, ...props }: any) => <ul {...props}>{children}</ul>,
  SidebarMenuItem: ({ children, ...props }: any) => <li {...props}>{children}</li>,
  SidebarMenuButton: ({ children, onClick, ...props }: any) => (
    <button type="button" onClick={onClick} {...props}>
      {children}
    </button>
  ),
  SidebarTrigger: () => null,
  useSidebar: () => ({ isMobile: false, setOpenMobile: vi.fn() }),
}));

vi.mock("../ui/tooltip", () => ({
  Tooltip: ({ children }: any) => <>{children}</>,
  TooltipTrigger: ({ render }: any) => render,
  TooltipPopup: ({ children, ...props }: any) => (
    <div data-slot="tooltip-popup" {...props}>
      {children}
    </div>
  ),
}));

vi.mock("./SidebarProviderUpdatePill", () => ({
  SidebarProviderUpdatePill: () => null,
}));

vi.mock("./SidebarUpdatePill", () => ({
  SidebarUpdateArchitectureWarning: () => null,
  SidebarUpdatePill: () => null,
}));

import { SidebarChromeFooter, SidebarUtilityMenu } from "./SidebarChrome";

describe("SidebarChromeFooter and SidebarUtilityMenu", () => {
  let renderer: ReactTestRenderer;

  afterEach(async () => {
    await act(() => renderer?.unmount());
    vi.clearAllMocks();
    vi.unstubAllGlobals();
    routerState.pathname = "/";
  });

  it("renders the settings button on standard routes and navigates to /settings when clicked", async () => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    routerState.pathname = "/";

    await act(() => {
      renderer = create(<SidebarChromeFooter />);
    });

    const footer = renderer.root.findByProps({ "data-testid": "sidebar-footer" });
    expect(footer.props.className).toContain("border-t");

    const settingsButton = renderer.root.findByProps({ "data-testid": "sidebar-settings-button" });
    expect(settingsButton.props["aria-label"]).toBe("Settings");

    await act(() => {
      settingsButton.props.onClick();
    });

    expect(routerState.navigate).toHaveBeenCalledWith({ to: "/settings" });
  });

  it("renders a Back button when on the /settings route and handles back navigation", async () => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    routerState.pathname = "/settings/general";

    const historyBack = vi.fn();
    vi.stubGlobal("window", { history: { back: historyBack } });

    await act(() => {
      renderer = create(<SidebarUtilityMenu />);
    });

    // In settings, settings button should not be present
    expect(renderer.root.findAllByProps({ "data-testid": "sidebar-settings-button" })).toHaveLength(0);

    // Back button should be present
    const backButton = renderer.root.findByType("button");
    expect(backButton.props.children[1].props.children).toBe("Back");

    await act(() => {
      backButton.props.onClick();
    });

    expect(historyBack).toHaveBeenCalled();
  });
});
