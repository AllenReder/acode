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
  useSidebar: () => ({ isMobile: false, toggleSidebar: vi.fn() }),
  useSidebarVisibility: () => true,
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

import { SidebarChromeHeader, SidebarChromeFooter } from "./SidebarChrome";

describe("SidebarChromeHeader and SidebarChromeFooter", () => {
  let renderer: ReactTestRenderer;

  afterEach(async () => {
    await act(() => renderer?.unmount());
    vi.clearAllMocks();
    vi.unstubAllGlobals();
    routerState.pathname = "/";
  });

  it("renders the settings button in header on standard routes and navigates to /settings when clicked", async () => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);

    await act(() => {
      renderer = create(<SidebarChromeHeader mode="main" />);
    });

    const settingsButton = renderer.root.findByProps({ "data-testid": "sidebar-settings-button" });
    expect(settingsButton.props["aria-label"]).toBe("Settings");

    await act(() => {
      settingsButton.props.onClick();
    });

    expect(routerState.navigate).toHaveBeenCalledWith({ to: "/settings" });
  });

  it("renders a Back button in header when on the settings route and handles back navigation", async () => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);

    const historyBack = vi.fn();
    vi.stubGlobal("window", { history: { back: historyBack } });

    await act(() => {
      renderer = create(<SidebarChromeHeader mode="settings" />);
    });

    expect(renderer.root.findAllByProps({ "data-testid": "sidebar-settings-button" })).toHaveLength(0);

    const backButton = renderer.root.findByProps({ "data-testid": "sidebar-back-button" });
    expect(backButton.props["aria-label"]).toBe("Back to workspace");

    await act(() => {
      backButton.props.onClick();
    });

    expect(historyBack).toHaveBeenCalled();
  });

  it("renders the toggle placeholder in the header to accommodate fixed control", async () => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);

    await act(() => {
      renderer = create(<SidebarChromeHeader mode="main" />);
    });

    const togglePlaceholder = renderer.root.findByProps({ "data-testid": "sidebar-toggle-placeholder" });
    expect(togglePlaceholder).toBeDefined();
  });
});
