import {
  ArrowLeftIcon,
  SettingsIcon,
} from "lucide-react";
import type { ReactNode } from "react";
import { memo, useCallback } from "react";
import { useCanGoBack, useLocation, useNavigate } from "@tanstack/react-router";

import { useEnvironmentIdentificationMode } from "../../hooks/useSettings";
import { isMacPlatform } from "../../lib/utils";
import { useEnvironments } from "../../state/environments";
import {
  resolveEnvironmentIdentificationPillLabel,
  useEnvironmentStageLabel,
} from "../SidebarStageBackdrop";
import { Badge } from "../ui/badge";
import {
  SidebarFooter,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarTrigger,
  useSidebar,
} from "../ui/sidebar";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";
import { readPullRequestListPreferences } from "../pullRequest/pullRequestListPreferences";
import { SidebarProviderUpdatePill } from "./SidebarProviderUpdatePill";
import { SidebarUpdateArchitectureWarning, SidebarUpdatePill } from "./SidebarUpdatePill";

export const SidebarChromeHeader = memo(function SidebarChromeHeader() {
  const stageLabel = useEnvironmentStageLabel();
  const environmentIdentificationMode = useEnvironmentIdentificationMode();
  const pillLabel =
    environmentIdentificationMode === "pill"
      ? resolveEnvironmentIdentificationPillLabel(stageLabel)
      : null;

  return (
    <SidebarHeader className="drag-region @container/sidebar-header relative h-[var(--workspace-topbar-height)] shrink-0 flex-row items-center px-3 py-0 md:px-0">
      <SidebarTrigger className="relative z-10 md:hidden" />
      {pillLabel ? (
        <Badge
          className="relative z-10 ml-1 hidden rounded-full px-1.5 text-muted-foreground @[15rem]/sidebar-header:inline-flex"
          data-environment-identification="pill"
          size="sm"
          variant="secondary"
        >
          {pillLabel}
        </Badge>
      ) : null}
    </SidebarHeader>
  );
});

function SidebarUtilityItem({
  icon,
  label,
  shortcut,
  onClick,
}: {
  icon: ReactNode;
  label: string;
  shortcut?: string;
  onClick: () => void;
}) {
  return (
    <SidebarMenuItem className="shrink-0">
      <Tooltip>
        <TooltipTrigger
          render={
            <SidebarMenuButton
              aria-label={label}
              data-testid="sidebar-settings-button"
              onClick={onClick}
              size="icon"
              className="rounded-md transition-all duration-150 ease-out hover:bg-sidebar-row-hover active:scale-[0.98]"
            >
              {icon}
            </SidebarMenuButton>
          }
        />
        <TooltipPopup side="top" className="flex items-center gap-1.5">
          <span>{label}</span>
          {shortcut ? (
            <span className="font-mono text-[10px] opacity-60">{shortcut}</span>
          ) : null}
        </TooltipPopup>
      </Tooltip>
    </SidebarMenuItem>
  );
}

export const SidebarUtilityMenu = memo(function SidebarUtilityMenu() {
  const navigate = useNavigate();
  const canGoBack = useCanGoBack();
  const { isMobile, setOpenMobile } = useSidebar();
  const currentFooterPage = useLocation({
    select: (location) =>
      /^\/settings(?:\/|$)/.test(location.pathname)
        ? "settings"
        : /^\/projects\/[^/]+\/?$/.test(location.pathname)
          ? "project-settings"
          : location.pathname === "/usage"
            ? "usage"
            : location.pathname === "/pull-requests"
              ? "pull-requests"
              : null,
  });
  const isMac = typeof navigator !== "undefined" && isMacPlatform(navigator.platform);

  const closeMobileSidebar = useCallback(() => {
    if (isMobile) {
      setOpenMobile(false);
    }
  }, [isMobile, setOpenMobile]);

  const handleSettingsClick = useCallback(() => {
    closeMobileSidebar();
    void navigate({ to: "/settings" });
  }, [closeMobileSidebar, navigate]);

  const handleBackClick = useCallback(() => {
    closeMobileSidebar();
    if (canGoBack && typeof window !== "undefined") {
      window.history.back();
      return;
    }
    void navigate({ to: "/" });
  }, [canGoBack, closeMobileSidebar, navigate]);

  return (
    <SidebarMenu className="flex-row items-center">
      {currentFooterPage ? (
        <SidebarMenuItem className="min-w-0 flex-1">
          <SidebarMenuButton
            onClick={handleBackClick}
            className="rounded-md transition-all duration-150 ease-out hover:bg-sidebar-row-hover active:scale-[0.98]"
          >
            <ArrowLeftIcon />
            <span>Back</span>
          </SidebarMenuButton>
        </SidebarMenuItem>
      ) : (
        <SidebarUtilityItem
          icon={<SettingsIcon className="size-4" />}
          label="Settings"
          shortcut={isMac ? "⌘," : "Ctrl+,"}
          onClick={handleSettingsClick}
        />
      )}
      <SidebarUpdatePill />
    </SidebarMenu>
  );
});

export const SidebarChromeFooter = memo(function SidebarChromeFooter() {
  return (
    <SidebarFooter
      data-testid="sidebar-footer"
      className="border-t border-sidebar-border/40 px-[var(--sidebar-content-inset)] py-1.5 backdrop-blur-sm"
    >
      <SidebarProviderUpdatePill />
      <SidebarUpdateArchitectureWarning />
      <SidebarUtilityMenu />
    </SidebarFooter>
  );
});
