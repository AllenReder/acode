import {
  ArrowLeftIcon,
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
  const { open } = useSidebar();
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

  const dockLeft = isMac ? "116px" : "40px";
  const expandedLeft = "calc(var(--sidebar-width) - 40px)";

  return (
    <SidebarHeader
      className="drag-region flex h-[var(--workbench-titlebar-height,36px)] shrink-0 flex-row items-center bg-sidebar p-0"
      data-tauri-drag-region
      data-sidebar-header=""
      style={{
        paddingLeft: isMac
          ? "var(--sidebar-controls-left, 76px)"
          : "var(--sidebar-controls-left-win, 0px)",
        paddingRight: "var(--sidebar-controls-right, 12px)",
      }}
    >
      <div
        className="size-7 shrink-0 pointer-events-none"
        data-slot="sidebar-header-toggle-placeholder"
        data-testid="sidebar-toggle-placeholder"
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
      <div
        className="fixed top-0 z-50 flex h-[var(--workbench-titlebar-height,36px)] items-center transition-[left] duration-200 ease-out in-data-[workbench-resizing]:transition-none in-data-[sidebar-resizing]:transition-none [-webkit-app-region:no-drag]"
        data-sidebar-docking-action=""
        style={{
          left: open ? expandedLeft : dockLeft,
        }}
      >
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
      </div>
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
