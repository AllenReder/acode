import {
  ArrowLeftIcon,
  PanelLeftCloseIcon,
  PanelLeftIcon,
  SettingsIcon,
} from "lucide-react";
import { memo, useCallback } from "react";
import { useCanGoBack, useNavigate } from "@tanstack/react-router";

import { useEnvironmentIdentificationMode } from "../../hooks/useSettings";
import { isMacPlatform } from "../../lib/utils";
import {
  resolveEnvironmentIdentificationPillLabel,
  useEnvironmentStageLabel,
} from "../SidebarStageBackdrop";
import { Badge } from "../ui/badge";
import {
  SidebarFooter,
  SidebarHeader,
  useSidebar,
  useSidebarVisibility,
} from "../ui/sidebar";
import { SidebarProviderUpdatePill } from "./SidebarProviderUpdatePill";
import { SidebarTitlebarButton } from "./SidebarTitlebarControl";
import { SidebarUpdateArchitectureWarning, SidebarUpdatePill } from "./SidebarUpdatePill";

export interface SidebarChromeHeaderProps {
  readonly mode?: "main" | "settings";
}

export const SidebarChromeHeader = memo(function SidebarChromeHeader({
  mode = "main",
}: SidebarChromeHeaderProps) {
  const navigate = useNavigate();
  const canGoBack = useCanGoBack();
  const { toggleSidebar } = useSidebar();
  const isOpen = useSidebarVisibility();
  const stageLabel = useEnvironmentStageLabel();
  const environmentIdentificationMode = useEnvironmentIdentificationMode();
  const pillLabel =
    environmentIdentificationMode === "pill"
      ? resolveEnvironmentIdentificationPillLabel(stageLabel)
      : null;
  const isMac = typeof navigator !== "undefined" && isMacPlatform(navigator.platform);

  const handleSettingsClick = useCallback(() => {
    void navigate({ to: "/settings" });
  }, [navigate]);

  const handleBackClick = useCallback(() => {
    if (canGoBack && typeof window !== "undefined") {
      window.history.back();
      return;
    }
    void navigate({ to: "/" });
  }, [canGoBack, navigate]);

  return (
    <SidebarHeader
      className="drag-region flex h-[var(--workbench-titlebar-height,36px)] shrink-0 flex-row items-center border-b border-sidebar-border/60 bg-sidebar p-0"
      data-tauri-drag-region
      data-sidebar-header=""
      style={{
        paddingLeft: isMac
          ? "var(--sidebar-controls-left, 76px)"
          : "var(--sidebar-controls-left-win, 12px)",
        paddingRight: "var(--sidebar-controls-right, 12px)",
      }}
    >
      <SidebarTitlebarButton
        icon={isOpen ? <PanelLeftCloseIcon className="size-4" /> : <PanelLeftIcon className="size-4" />}
        label="Toggle main sidebar"
        shortcut={isMac ? "⌘B" : "Ctrl+B"}
        ariaLabel="Toggle main sidebar"
        ariaPressed={isOpen}
        onClick={toggleSidebar}
        testId="sidebar-toggle-button"
      />
      {pillLabel ? (
        <Badge
          className="relative z-10 ml-2 hidden rounded-full px-1.5 text-muted-foreground @[15rem]/sidebar-header:inline-flex"
          data-environment-identification="pill"
          size="sm"
          variant="secondary"
        >
          {pillLabel}
        </Badge>
      ) : null}
      <div className="flex-1 min-w-0 h-full pointer-events-none" data-tauri-drag-region />
      {mode === "settings" ? (
        <SidebarTitlebarButton
          icon={<ArrowLeftIcon className="size-4" />}
          label="Back to workspace"
          shortcut={isMac ? "⌘, / Esc" : "Ctrl+, / Esc"}
          onClick={handleBackClick}
          testId="sidebar-back-button"
        />
      ) : (
        <SidebarTitlebarButton
          icon={<SettingsIcon className="size-4" />}
          label="Settings"
          shortcut={isMac ? "⌘," : "Ctrl+,"}
          onClick={handleSettingsClick}
          testId="sidebar-settings-button"
        />
      )}
    </SidebarHeader>
  );
});

export const SidebarChromeFooter = memo(function SidebarChromeFooter() {
  return (
    <SidebarFooter
      data-testid="sidebar-footer"
      className="border-t border-sidebar-border/40 px-[var(--sidebar-content-inset)] py-1.5 backdrop-blur-sm empty:hidden"
    >
      <SidebarProviderUpdatePill />
      <SidebarUpdateArchitectureWarning />
      <SidebarUpdatePill />
    </SidebarFooter>
  );
});
