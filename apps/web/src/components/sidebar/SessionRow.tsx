import type { ComponentProps } from "react";
import { cn } from "../../lib/utils";
import { getActiveTab } from "../../workbench/workbenchState";
import { useWorkbenchStore } from "../../workbench/workbenchStore";
import { targetsEqual, type ViewTarget } from "../../workbench/viewRegistry";
import { useSessionActionMenu } from "../../hooks/useSessionActionMenu";

export type SessionTarget = Extract<ViewTarget, { kind: "agentSession" | "workspaceTerminal" }>;

export interface SessionRowProps extends ComponentProps<"button"> {
  readonly target: SessionTarget;
  readonly isClosed?: boolean;
  readonly sessionTitle?: string;
  readonly onStartRename?: () => void;
}

/** Sidebar navigation addresses Sessions; Workbench commands own layout and uniqueness. */
export function SessionRow({
  target,
  isClosed = false,
  sessionTitle,
  onStartRename,
  onClick,
  onContextMenu,
  onKeyDown,
  className,
  ...props
}: SessionRowProps) {
  const selected = useWorkbenchStore((state) => {
    const tab = getActiveTab(state);
    const focused = tab.panes.get(tab.focusedPaneId);
    return focused !== undefined && targetsEqual(focused.target, target);
  });

  const { openMenu } = useSessionActionMenu({
    target,
    isClosed,
    sessionTitle,
    onStartRename,
  });

  return (
    <button
      {...props}
      type="button"
      role="treeitem"
      aria-level={3}
      className={cn(
        "flex min-h-6 w-full items-center gap-1.5 rounded-md px-2 text-left text-xs text-sidebar-muted-foreground hover:bg-sidebar-row-hover hover:text-sidebar-foreground",
        selected && "bg-sidebar-row-active text-sidebar-foreground",
        isClosed && "opacity-75",
        className,
      )}
      aria-current={selected ? "page" : undefined}
      aria-description="Open Session (Alt/Option: split right; Alt/Option+Shift: split down)"
      onClick={(event) => {
        const commands = useWorkbenchStore.getState();
        if (event.altKey) commands.splitFocused(target, event.shiftKey ? "down" : "right");
        else commands.openTarget(target);
        onClick?.(event);
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
    />
  );
}
