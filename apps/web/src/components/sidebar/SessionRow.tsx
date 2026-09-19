import type { ComponentProps } from "react";
import { cn } from "../../lib/utils";
import { getActiveTab } from "../../workbench/workbenchState";
import { useWorkbenchStore } from "../../workbench/workbenchStore";
import { targetsEqual, type ViewTarget } from "../../workbench/viewRegistry";

type SessionTarget = Extract<ViewTarget, { kind: "agentSession" | "workspaceTerminal" }>;

/** Sidebar navigation addresses Sessions; Workbench commands own layout and uniqueness. */
export function SessionRow({
  target,
  onClick,
  className,
  ...props
}: ComponentProps<"button"> & {
  readonly target: SessionTarget;
}) {
  const selected = useWorkbenchStore((state) => {
    const tab = getActiveTab(state);
    const focused = tab.panes.get(tab.focusedPaneId);
    return focused !== undefined && targetsEqual(focused.target, target);
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
    />
  );
}
