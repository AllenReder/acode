import type { ComponentProps } from "react";
import { cn } from "../../lib/utils";
import { getActiveTab } from "../../workbench/workbenchState";
import { useWorkbenchStore } from "../../workbench/workbenchStore";
import { targetsEqual, type ViewTarget } from "../../workbench/viewRegistry";
import { sessionRouteForTarget } from "../../workbench/deepLinks";
import { useSessionActionMenu } from "../../hooks/useSessionActionMenu";
import { useWorkbenchDragSource } from "../../workbench/workbenchDrag";

export type SessionTarget = Extract<ViewTarget, { kind: "agentSession" | "workspaceTerminal" }>;

export interface SessionRowProps extends ComponentProps<"button"> {
  readonly target: SessionTarget;
  readonly isClosed?: boolean;
  readonly sessionTitle?: string;
  readonly onStartRename?: () => void;
  readonly navigateTo?: (input: {
    readonly to: string;
    readonly params: Record<string, string>;
    readonly replace: boolean;
  }) => void;
}

/** Sidebar navigation addresses Sessions; Workbench commands own layout and uniqueness. */
export function SessionRow({
  target,
  isClosed = false,
  sessionTitle,
  onStartRename,
  navigateTo,
  onClick,
  onClickCapture,
  onContextMenu,
  onKeyDown,
  onPointerDown,
  className,
  ...props
}: SessionRowProps) {
  const isFocused = useWorkbenchStore((state) => {
    const tab = getActiveTab(state);
    const focused = tab.panes.get(tab.focusedPaneId);
    return focused !== undefined && targetsEqual(focused.target, target);
  });

  const isOpenInActiveTab = useWorkbenchStore((state) => {
    const tab = getActiveTab(state);
    for (const pane of tab.panes.values()) {
      if (targetsEqual(pane.target, target)) return true;
    }
    return false;
  });

  const { openMenu } = useSessionActionMenu({
    target,
    isClosed,
    sessionTitle,
    onStartRename,
    navigateTo,
  });
  const drag = useWorkbenchDragSource(
    { kind: "sidebar", target },
    sessionTitle ?? (target.kind === "agentSession" ? "Agent Session" : "Terminal Session"),
  );
  const navigateTarget = () => {
    const route = sessionRouteForTarget(target);
    if (navigateTo !== undefined) {
      navigateTo({ ...route, replace: true });
      return;
    }
    if (typeof window !== "undefined" && "__acodeRouter" in window) {
      const router = (window as { __acodeRouter?: { navigate: (input: unknown) => void } })
        .__acodeRouter;
      router?.navigate({ ...route, replace: true });
    }
  };

  return (
    <button
      {...props}
      type="button"
      role="treeitem"
      aria-level={3}
      data-workbench-drag-source="sidebar"
      className={cn(
        "flex min-h-6 w-full items-center gap-1.5 rounded-md px-2 text-left text-xs text-sidebar-muted-foreground hover:bg-sidebar-row-hover hover:text-sidebar-foreground",
        isFocused
          ? "bg-sidebar-row-active font-medium text-sidebar-foreground"
          : isOpenInActiveTab
            ? "bg-sidebar-row-selected text-sidebar-foreground"
            : undefined,
        isClosed && "opacity-75",
        className,
      )}
      aria-current={isFocused ? "page" : isOpenInActiveTab ? "true" : undefined}
      data-session-focused={isFocused ? "true" : "false"}
      data-session-open-in-tab={isOpenInActiveTab ? "true" : "false"}
      aria-description="Open Session (Alt/Option: split right; Alt/Option+Shift: split down)"
      onClick={(event) => {
        const commands = useWorkbenchStore.getState();
        if (event.altKey) {
          commands.splitFocused(target, event.shiftKey ? "down" : "right");
        } else {
          commands.openTarget(target);
          navigateTarget();
        }
        onClick?.(event);
      }}
      onClickCapture={(event) => {
        if (drag.consumeSuppressedClick()) {
          event.preventDefault();
          event.stopPropagation();
          return;
        }
        onClickCapture?.(event);
      }}
      onContextMenu={(event) => {
        event.preventDefault();
        event.stopPropagation();
        openMenu({ x: event.clientX, y: event.clientY });
        onContextMenu?.(event);
      }}
      onKeyDown={(event) => {
        if (event.key === "ContextMenu" || (event.shiftKey && event.key === "F10")) {
          event.preventDefault();
          event.stopPropagation();
          const rect = event.currentTarget.getBoundingClientRect();
          openMenu({ x: rect.left + rect.width / 2, y: rect.bottom });
        }
        onKeyDown?.(event);
      }}
      onPointerDown={(event) => {
        drag.onPointerDown(event);
        onPointerDown?.(event);
      }}
    />
  );
}
