import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
} from "react";
import { CopyPlusIcon, GripVerticalIcon } from "lucide-react";

import type { EnvironmentAcodeProject } from "@t3tools/client-runtime/state/models";
import { readLocalApi } from "../localApi";
import { type LayoutNode, type SplitDir } from "./layout";
import { resolveViewDefinition, type ViewTarget } from "./viewRegistry";
import { useWorkbenchStore } from "./workbenchStore";
import { getActiveTab, type WorkbenchSnapshot } from "./workbenchState";
import { useWorkbenchDragSource } from "./workbenchDrag";
import { resolveTargetBreadcrumbs } from "./workbenchTitles";

interface PaneTreeProps {
  readonly snapshot: WorkbenchSnapshot;
  readonly projects?: ReadonlyArray<EnvironmentAcodeProject>;
}

/**
 * Render the workbench's layout tree. Each leaf becomes a `Pane` whose body
 * is dispatched through the View registry. Sashes between split leaves are
 * draggable and forward their ratio to `setSplitRatio`. Clicking anywhere
 * in a Pane focuses it (per the C10 issue: "clicking a Pane focuses it
 * without changing other Panes' data").
 *
 * C10 ships BSP + click-focus + drag-resize. Drag-to-move (cross-pane drop)
 * is C12 and explicitly deferred by the ticket.
 */
export function PaneTree({ snapshot, projects = [] }: PaneTreeProps) {
  return (
    <div className="flex h-full min-h-0 min-w-0 flex-1 flex-col">
      <PaneNode
        snapshot={snapshot}
        projects={projects}
        node={getActiveTab(snapshot).layout}
        focusedPaneId={getActiveTab(snapshot).focusedPaneId}
      />
    </div>
  );
}

interface PaneNodeProps {
  readonly snapshot: WorkbenchSnapshot;
  readonly projects: ReadonlyArray<EnvironmentAcodeProject>;
  readonly node: LayoutNode;
  readonly focusedPaneId: string;
}

function PaneNode({ snapshot, projects, node, focusedPaneId }: PaneNodeProps) {
  if (node.type === "leaf") {
    return (
      <Pane
        snapshot={snapshot}
        projects={projects}
        paneId={node.id}
        focused={node.id === focusedPaneId}
      />
    );
  }

  // Split node: use absolute positioning so each child gets an explicit
  // (left, top, width, height) from the layout leaves. Flex math fights
  // the sash width — when child wrappers sum to 100% the sash (default
  // flex-shrink: 1) collapses to 0px. Absolute positioning avoids that.
  const children: ReactNode[] = [];
  const sashes: ReactNode[] = [];
  let offset = 0;
  for (let i = 0; i < node.children.length; i++) {
    const child = node.children[i];
    if (child === undefined) continue;
    const size = node.sizes[i] ?? 0;
    const childStyle =
      node.dir === "right"
        ? { left: `${offset * 100}%`, top: 0, width: `${size * 100}%`, height: "100%" }
        : { top: `${offset * 100}%`, left: 0, height: `${size * 100}%`, width: "100%" };
    children.push(
      <div
        key={child.type === "leaf" ? `leaf-${child.id}` : `split-${child.id}`}
        className="absolute flex min-h-0 min-w-0 flex-col overflow-hidden"
        style={childStyle}
      >
        <PaneNode
          snapshot={snapshot}
          projects={projects}
          node={child}
          focusedPaneId={focusedPaneId}
        />
      </div>,
    );
    if (i > 0) {
      const sashStyle =
        node.dir === "right"
          ? { left: `calc(${offset * 100}% - 2px)`, top: 0, width: "4px", height: "100%" }
          : { top: `calc(${offset * 100}% - 2px)`, left: 0, height: "4px", width: "100%" };
      sashes.push(
        <SashHandle
          key={`sash-${node.id}-${i - 1}`}
          splitId={node.id}
          index={i - 1}
          dir={node.dir}
          sizes={node.sizes}
          style={sashStyle}
        />,
      );
    }
    offset += size;
  }

  return (
    <div className="relative h-full min-h-0 min-w-0 flex-1">
      {children}
      {sashes}
    </div>
  );
}

interface PaneProps {
  readonly snapshot: WorkbenchSnapshot;
  readonly projects: ReadonlyArray<EnvironmentAcodeProject>;
  readonly paneId: string;
  readonly focused: boolean;
}

function Pane({ snapshot, projects, paneId, focused }: PaneProps) {
  const setFocused = useWorkbenchStore((s) => s.setFocused);
  const focusRequestId = useWorkbenchStore((s) => s.focusRequestId);
  const closeView = useWorkbenchStore((s) => s.closeView);
  const duplicateToNewTab = useWorkbenchStore((s) => s.duplicateToNewTab);
  const activeTab = getActiveTab(snapshot);
  const view = activeTab.panes.get(paneId);
  const target = view?.target ?? null;
  const breadcrumbs =
    target === null ? ["Unavailable View"] : resolveTargetBreadcrumbs(target, projects);
  const drag = useWorkbenchDragSource(
    { kind: "pane", tabId: activeTab.id, paneId },
    breadcrumbs.at(-1) ?? "View",
  );

  const onClick = useCallback(() => {
    if (!focused) setFocused(paneId);
  }, [focused, paneId, setFocused]);

  const onDuplicate = () => {
    duplicateToNewTab({ kind: "pane", tabId: activeTab.id, paneId });
  };

  const openPaneMenu = (position: { readonly x: number; readonly y: number }) => {
    const api = readLocalApi();
    if (!api) return;
    void api.contextMenu
      .show([{ id: "duplicate", label: "Duplicate pane", icon: "copy-plus" }], position)
      .then((clicked) => {
        if (clicked === "duplicate") onDuplicate();
      });
  };

  const contentRef = useRef<HTMLDivElement>(null);
  const [availableSize, setAvailableSize] = useState({ width: 0, height: 0 });
  useEffect(() => {
    const element = contentRef.current;
    if (!element) return;
    const update = ({ width, height }: { width: number; height: number }) => {
      setAvailableSize((previous) =>
        previous.width === width && previous.height === height ? previous : { width, height },
      );
    };
    update(element.getBoundingClientRect());
    const observer = new ResizeObserver((entries) => {
      const entry = entries[0];
      if (entry) update(entry.contentRect);
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, []);
  const definition = target !== null ? resolveViewDefinition(target) : null;

  return (
    <div
      role="region"
      aria-label={target !== null ? `Pane ${target.kind}` : "Unavailable View"}
      onMouseDown={onClick}
      onFocus={onClick}
      className={
        "flex h-full min-h-0 min-w-0 flex-1 flex-col " +
        (focused ? "outline outline-1 outline-accent" : "")
      }
      data-pane-id={paneId}
      data-workbench-pane-drop=""
      data-workbench-tab-id={activeTab.id}
      data-view-instance-id={view?.id}
      data-pane-focused={focused}
      data-pane-target-kind={target?.kind ?? "empty"}
    >
      <PaneHeader
        paneId={paneId}
        target={target}
        breadcrumbs={breadcrumbs}
        focused={focused}
        onDragStart={drag.onPointerDown}
        onDuplicate={onDuplicate}
        onOpenMenu={openPaneMenu}
        onClose={() => closeView(paneId)}
      />
      <div ref={contentRef} className="flex h-full min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
        {definition === null ? (
          <EmptyPane target={target} />
        ) : (
          <definition.Component
            key={view?.id}
            target={target!}
            paneId={paneId}
            focused={focused}
            focusRequestId={focusRequestId}
            availableSize={availableSize}
          />
        )}
      </div>
    </div>
  );
}

function PaneHeader({
  paneId,
  target,
  breadcrumbs,
  focused,
  onDragStart,
  onDuplicate,
  onOpenMenu,
  onClose,
}: {
  readonly paneId: string;
  readonly target: ViewTarget | null;
  readonly breadcrumbs: ReadonlyArray<string>;
  readonly focused: boolean;
  readonly onDragStart: (event: ReactPointerEvent<HTMLElement>) => void;
  readonly onDuplicate: () => void;
  readonly onOpenMenu: (position: { readonly x: number; readonly y: number }) => void;
  readonly onClose: () => void;
}) {
  void paneId;
  void focused;
  return (
    <div
      className="flex h-8 touch-none cursor-grab items-center justify-between gap-2 border-b border-border px-3 text-xs text-muted-foreground active:cursor-grabbing"
      tabIndex={0}
      onPointerDown={(event) => {
        const targetElement = event.target as HTMLElement;
        if (
          targetElement.closest("button") !== null &&
          targetElement.closest("[data-workbench-pane-drag-handle]") === null
        ) {
          return;
        }
        onDragStart(event);
      }}
      onContextMenu={(event) => {
        event.preventDefault();
        event.stopPropagation();
        onOpenMenu({ x: event.clientX, y: event.clientY });
      }}
      onKeyDown={(event) => {
        if (event.key !== "ContextMenu" && !(event.shiftKey && event.key === "F10")) return;
        event.preventDefault();
        event.stopPropagation();
        const rect = event.currentTarget.getBoundingClientRect();
        onOpenMenu({ x: rect.left + rect.width / 2, y: rect.bottom });
      }}
    >
      <div className="flex min-w-0 flex-1 items-center gap-1.5 overflow-hidden">
        {breadcrumbs.map((breadcrumb, index) => (
          <span key={`${breadcrumb}-${index}`} className="flex min-w-0 items-center gap-1.5">
            {index > 0 ? <span className="shrink-0 text-muted-foreground/50">·</span> : null}
            <span
              className={
                index === breadcrumbs.length - 1
                  ? "truncate text-foreground"
                  : "truncate text-muted-foreground"
              }
            >
              {breadcrumb}
            </span>
          </span>
        ))}
      </div>
      <div className="flex items-center gap-0.5">
        <button
          type="button"
          aria-label="Duplicate pane"
          className="flex size-5 items-center justify-center rounded text-muted-foreground hover:bg-accent hover:text-foreground"
          onClick={onDuplicate}
        >
          <CopyPlusIcon className="size-3" />
        </button>
        <button
          type="button"
          aria-label="Move pane"
          data-workbench-pane-drag-handle=""
          className="flex size-5 touch-none cursor-grab items-center justify-center rounded text-muted-foreground hover:bg-accent hover:text-foreground active:cursor-grabbing"
        >
          <GripVerticalIcon className="size-3" />
        </button>
        <button
          type="button"
          aria-label="Close pane"
          className="rounded px-1.5 py-0.5 text-muted-foreground hover:bg-accent hover:text-foreground"
          onClick={onClose}
        >
          ×
        </button>
      </div>
    </div>
  );
}

function EmptyPane({ target }: { readonly target: ViewTarget | null }) {
  if (target !== null) {
    return (
      <div className="flex h-full min-h-0 items-center justify-center p-6 text-sm text-muted-foreground">
        No View registered for {target.kind}.
      </div>
    );
  }
  return (
    <div className="flex h-full min-h-0 items-center justify-center p-6 text-sm text-muted-foreground">
      View unavailable.
    </div>
  );
}

interface SashHandleProps {
  readonly splitId: string;
  readonly index: number;
  readonly dir: SplitDir;
  readonly sizes: ReadonlyArray<number>;
  readonly style: React.CSSProperties;
}

function SashHandle({ splitId, index, dir, sizes, style }: SashHandleProps) {
  const setSplitRatio = useWorkbenchStore((s) => s.setSplitRatio);
  // Drag bookkeeping. We capture the parent split container's rect on
  // mousedown — the sash itself is only 1px wide/tall, so its own rect
  // yields a zero totalPx and the drag silently no-ops.
  const dragStateRef = useRef<{
    startPx: number;
    sizes: number[];
    totalPx: number;
  } | null>(null);
  const [hover, setHover] = useState(false);

  const onMouseDown = useCallback(
    (event: React.MouseEvent<HTMLDivElement>) => {
      event.preventDefault();
      // Walk to the parent flex wrapper: it owns the full width/height
      // that the two sibling leaves share. Fallback to the viewport if the
      // parent is missing (defensive — should not happen in the tree).
      const container = event.currentTarget.parentElement?.getBoundingClientRect();
      const totalPx =
        container !== undefined
          ? dir === "right"
            ? container.width
            : container.height
          : dir === "right"
            ? window.innerWidth
            : window.innerHeight;
      const startPx = dir === "right" ? event.clientX : event.clientY;
      dragStateRef.current = { startPx, sizes: [...sizes], totalPx };

      const move = (e: MouseEvent) => {
        const state = dragStateRef.current;
        if (state === null) return;
        const currentPx = dir === "right" ? e.clientX : e.clientY;
        const deltaPx = currentPx - state.startPx;
        const ratio = state.totalPx > 0 ? deltaPx / state.totalPx : 0;
        const a = state.sizes[index];
        const b = state.sizes[index + 1];
        if (a === undefined || b === undefined) return;
        const pair = a + b;
        if (pair === 0) return;
        const before = state.sizes.slice(0, index).reduce((sum, size) => sum + size, 0);
        const boundary = before + a + ratio;
        setSplitRatio(splitId, index, Math.max(before, Math.min(before + pair, boundary)));
      };
      const up = () => {
        dragStateRef.current = null;
        window.removeEventListener("mousemove", move);
        window.removeEventListener("mouseup", up);
      };
      window.addEventListener("mousemove", move);
      window.addEventListener("mouseup", up);
    },
    [dir, index, setSplitRatio, sizes, splitId],
  );

  useEffect(
    () => () => {
      // Detach listeners if the sash unmounts mid-drag.
      dragStateRef.current = null;
    },
    [],
  );

  return (
    <div
      role="separator"
      aria-orientation={dir === "right" ? "vertical" : "horizontal"}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      onMouseDown={onMouseDown}
      className={
        "absolute z-10 " +
        (dir === "right" ? "cursor-col-resize " : "cursor-row-resize ") +
        (hover ? "bg-foreground/40" : "bg-foreground/15")
      }
      style={style}
      data-sash-id={splitId}
      data-sash-index={index}
    />
  );
}
