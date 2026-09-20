import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
} from "react";
import {
  ArrowLeftIcon,
  ArrowRightIcon,
  ArrowUpIcon,
  ArrowDownIcon,
  PlusIcon,
  CopyPlusIcon,
  GripVerticalIcon,
} from "lucide-react";

import type { EnvironmentAcodeProject } from "@t3tools/client-runtime/state/models";
import { readLocalApi } from "../localApi";
import { layoutLeaves, layoutSashes, type SplitDir } from "./layout";
import { MIN_PANE_HEIGHT } from "./scrollingLayout";
import { resolveViewDefinition, type ViewTarget } from "./viewRegistry";
import { useWorkbenchStore } from "./workbenchStore";
import { getActiveTab, type WorkbenchSnapshot } from "./workbenchState";
import { useWorkbenchDragSource } from "./workbenchDrag";
import { resolveTargetBreadcrumbs } from "./workbenchTitles";

interface PaneTreeProps {
  readonly snapshot: WorkbenchSnapshot;
  readonly projects?: ReadonlyArray<EnvironmentAcodeProject>;
}

/** Stable sibling keys preserve View mounts across every layout mutation. */
const EMPTY_PROJECTS: ReadonlyArray<EnvironmentAcodeProject> = [];

export function PaneTree({ snapshot, projects = EMPTY_PROJECTS }: PaneTreeProps) {
  const tab = getActiveTab(snapshot);
  const scrolling = tab.layoutMode === "scrolling";
  const viewportRef = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ width: 0, height: 0 });
  const changeColumn = useWorkbenchStore((s) => s.changeColumn);
  const previousRects = useRef(new Map<string, DOMRect>());
  useLayoutEffect(() => {
    const viewport = viewportRef.current;
    if (!viewport?.querySelectorAll) return;
    const frames = viewport.querySelectorAll<HTMLElement>(".workbench-pane-frame");
    const next = new Map<string, DOMRect>();
    for (const frame of frames) {
      const id =
        frame.querySelector<HTMLElement>("[data-view-instance-id]")?.dataset.viewInstanceId;
      if (!id) continue;
      const rect = frame.getBoundingClientRect();
      next.set(id, rect);
      const old = previousRects.current.get(id);
      if (
        !old ||
        document.documentElement.dataset.workbenchResizing ||
        window.matchMedia("(prefers-reduced-motion: reduce)").matches
      )
        continue;
      const dx = old.left - rect.left;
      const dy = old.top - rect.top;
      if (Math.abs(dx) + Math.abs(dy) > 1) {
        frame.getAnimations().forEach((animation) => animation.cancel());
        frame.animate(
          [{ transform: "translate(" + dx + "px," + dy + "px)" }, { transform: "translate(0,0)" }],
          { duration: 220, easing: "cubic-bezier(.2,.8,.2,1)" },
        );
      }
    }
    previousRects.current = next;
  }, [tab.layout]);
  useEffect(() => {
    const element = viewportRef.current;
    if (!element) return;
    const update = () => setSize({ width: element.clientWidth, height: element.clientHeight });
    update();
    const observer = new ResizeObserver(update);
    observer.observe(element);
    return () => observer.disconnect();
  }, []);
  useEffect(() => {
    if (!scrolling) return;
    const viewport = viewportRef.current;
    const pane = viewport?.querySelector<HTMLElement>(
      '[data-pane-id="' + CSS.escape(tab.focusedPaneId) + '"]',
    );
    if (!viewport || !pane) return;
    const frame = pane.parentElement;
    if (!frame) return;
    const left = frame.offsetLeft;
    const right = left + frame.offsetWidth;
    const delta =
      left < viewport.scrollLeft || frame.offsetWidth > viewport.clientWidth
        ? left - viewport.scrollLeft
        : right > viewport.scrollLeft + viewport.clientWidth
          ? right - viewport.scrollLeft - viewport.clientWidth
          : 0;
    if (delta)
      viewport.scrollBy({
        left: delta,
        behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches
          ? "instant"
          : "smooth",
      });
  }, [scrolling, tab.id, tab.focusedPaneId, tab.columns, size.width]);

  useEffect(() => {
    const viewport = viewportRef.current;
    if (!scrolling || !viewport) return;
    const wheel = (event: WheelEvent) => {
      if (Math.abs(event.deltaX) <= Math.abs(event.deltaY) || event.ctrlKey) return;
      event.preventDefault();
      event.stopPropagation();
      viewport.scrollLeft +=
        event.deltaX *
        (event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? viewport.clientWidth : 1);
    };
    viewport.addEventListener("wheel", wheel, { capture: true, passive: false });
    return () => viewport.removeEventListener("wheel", wheel, true);
  }, [scrolling]);
  const columns = tab.columns ?? [];
  const width = scrolling ? columns.reduce((sum, c) => sum + c.width + 8, 0) : size.width;
  const height = scrolling
    ? Math.max(
        size.height,
        ...columns.flatMap((c) => c.shares.map((share) => MIN_PANE_HEIGHT / share)),
      )
    : size.height;
  const rects = new Map<string, React.CSSProperties>();
  let left = 0;
  if (scrolling) {
    for (const column of columns) {
      let top = 0;
      column.paneIds.forEach((id, index) => {
        const paneHeight = (column.shares[index] ?? 1) * height;
        rects.set(id, { left, top, width: column.width, height: paneHeight });
        top += paneHeight;
      });
      left += column.width + 8;
    }
  } else {
    for (const { id, rect } of layoutLeaves(tab.layout))
      rects.set(id, {
        left: rect.x * width,
        top: rect.y * height,
        width: rect.w * width,
        height: rect.h * height,
      });
  }
  let columnLeft = 0;
  return (
    <div
      ref={viewportRef}
      className="workbench-viewport"
      data-layout-mode={scrolling ? "scrolling" : "bsp"}
    >
      <div className="workbench-canvas" style={{ width: Math.max(width, size.width), height }}>
        {[...tab.panes].map(([paneId, view]) => (
          <div key={view.id} className="workbench-pane-frame" style={rects.get(paneId)}>
            <Pane
              snapshot={snapshot}
              projects={projects}
              paneId={paneId}
              focused={paneId === tab.focusedPaneId}
            />
          </div>
        ))}
        {scrolling
          ? columns.map((column) => {
              const x = columnLeft;
              columnLeft += column.width + 8;
              let boundary = 0;
              return (
                <div key={column.id}>
                  <ResizeHandle
                    label="Column width"
                    dir="right"
                    style={{ left: x + column.width - 2, top: 0, width: 8, height }}
                    onDelta={(delta) => changeColumn(column.id, { width: column.width + delta })}
                  />
                  {column.shares.slice(0, -1).map((share, index) => {
                    boundary += share;
                    return (
                      <ResizeHandle
                        key={column.paneIds[index]}
                        label="Pane height"
                        dir="down"
                        style={{
                          left: x,
                          top: boundary * height - 3,
                          width: column.width,
                          height: 6,
                        }}
                        onDelta={(delta) => {
                          const shares = [...column.shares];
                          const a = shares[index]!;
                          const b = shares[index + 1]!;
                          const min = Math.min(MIN_PANE_HEIGHT / height, (a + b) / 2);
                          const next = Math.max(min, Math.min(a + b - min, a + delta / height));
                          shares[index] = next;
                          shares[index + 1] = a + b - next;
                          changeColumn(column.id, { shares });
                        }}
                      />
                    );
                  })}
                </div>
              );
            })
          : layoutSashes(tab.layout).map((sash) => {
              const boundary = sash.sizes.slice(0, sash.index + 1).reduce((a, b) => a + b, 0);
              const row = sash.dir === "right";
              return (
                <SashHandle
                  key={sash.splitId + "-" + sash.index}
                  {...sash}
                  style={
                    row
                      ? {
                          left: (sash.group.x + boundary * sash.group.w) * width - 3,
                          top: sash.group.y * height,
                          width: 6,
                          height: sash.group.h * height,
                        }
                      : {
                          left: sash.group.x * width,
                          top: (sash.group.y + boundary * sash.group.h) * height - 3,
                          width: sash.group.w * width,
                          height: 6,
                        }
                  }
                  totalPx={row ? sash.group.w * width : sash.group.h * height}
                />
              );
            })}
      </div>
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
      className={"workbench-pane flex h-full min-h-0 min-w-0 flex-1 flex-col"}
      data-pane-id={paneId}
      data-workbench-pane-drop=""
      data-workbench-tab-id={activeTab.id}
      data-view-instance-id={view?.id}
      data-pane-focused={focused}
      data-pane-target-kind={target?.kind ?? "empty"}
    >
      {activeTab.layoutMode === "scrolling" && (
        <ColumnControls paneId={paneId} snapshot={snapshot} projects={projects} />
      )}
      <PaneHeader
        paneId={paneId}
        breadcrumbs={breadcrumbs}
        focused={focused}
        onDragStart={drag.onPointerDown}
        onDuplicate={onDuplicate}
        onOpenMenu={openPaneMenu}
        onClose={() => closeView(paneId)}
      />
      <div ref={contentRef} className="flex h-full min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
        <div className="flex h-full min-h-0 min-w-0 flex-1 flex-col">
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
    </div>
  );
}

function PaneHeader({
  paneId,
  breadcrumbs,
  focused,
  onDragStart,
  onDuplicate,
  onOpenMenu,
  onClose,
}: {
  readonly paneId: string;
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

function ColumnControls({
  paneId,
  snapshot,
  projects,
}: {
  paneId: string;
  snapshot: WorkbenchSnapshot;
  projects: ReadonlyArray<EnvironmentAcodeProject>;
}) {
  const tab = getActiveTab(snapshot);
  const columns = tab.columns ?? [];
  const columnIndex = columns.findIndex((c) => c.paneIds.includes(paneId));
  const column = columns[columnIndex];
  const changeColumn = useWorkbenchStore((s) => s.changeColumn);
  const moveInColumn = useWorkbenchStore((s) => s.moveInColumn);
  const addPane = async (dir: SplitDir, element: HTMLElement) => {
    const api = readLocalApi();
    if (!api) return;
    const choices = projects.flatMap((project) =>
      project.workspaces.flatMap((workspace) =>
        (workspace.sessions ?? []).flatMap((session) => {
          const target: ViewTarget | null =
            session.kind === "agent"
              ? {
                  kind: "agentSession",
                  environmentId: project.environmentId,
                  workspaceId: workspace.id,
                  agentSessionId: session.id,
                }
              : session.kind === "terminal"
                ? {
                    kind: "workspaceTerminal",
                    environmentId: project.environmentId,
                    workspaceId: workspace.id,
                    terminalSessionId: session.id,
                  }
                : null;
          return target
            ? [{ target, label: resolveTargetBreadcrumbs(target, projects).join(" · ") }]
            : [];
        }),
      ),
    );
    const bounds = element.getBoundingClientRect();
    const selected = await api.contextMenu.show(
      choices.length
        ? choices.map((choice, index) => ({ id: String(index), label: choice.label }))
        : [{ id: "empty", label: "Open a Session from the sidebar first", disabled: true }],
      { x: bounds.left, y: bounds.bottom },
    );
    const choice = choices[Number(selected)];
    if (selected === null || !choice) return;
    const store = useWorkbenchStore.getState();
    if (store.activeTabId !== tab.id || !getActiveTab(store).panes.has(paneId)) return;
    store.setFocused(paneId);
    useWorkbenchStore.getState().splitFocused(choice.target, dir);
  };
  if (!column) return null;
  const index = column.paneIds.indexOf(paneId);
  return (
    <div className="workbench-column-controls">
      <span>{index === 0 ? "Column " + (columnIndex + 1) : "Stack " + (index + 1)}</span>
      <div className="flex gap-1">
        <button
          aria-label="New column"
          onClick={(event) => void addPane("right", event.currentTarget)}
        >
          <PlusIcon />
        </button>
        <button
          aria-label="Add pane below"
          onClick={(event) => void addPane("down", event.currentTarget)}
        >
          <CopyPlusIcon />
        </button>
        <button
          aria-label="Move column left"
          disabled={columnIndex === 0}
          onClick={() => changeColumn(column.id, { direction: -1 })}
        >
          <ArrowLeftIcon />
        </button>
        <button
          aria-label="Move column right"
          disabled={columnIndex === columns.length - 1}
          onClick={() => changeColumn(column.id, { direction: 1 })}
        >
          <ArrowRightIcon />
        </button>
        <button
          aria-label="Move pane up"
          disabled={index === 0}
          onClick={() => moveInColumn(paneId, -1)}
        >
          <ArrowUpIcon />
        </button>
        <button
          aria-label="Move pane down"
          disabled={index === column.paneIds.length - 1}
          onClick={() => moveInColumn(paneId, 1)}
        >
          <ArrowDownIcon />
        </button>
      </div>
    </div>
  );
}

interface ResizeHandleProps {
  readonly dir: SplitDir;
  readonly style: React.CSSProperties;
  readonly label: string;
  readonly onDelta: (delta: number) => void;
  readonly splitId?: string;
  readonly index?: number;
}
function ResizeHandle({ dir, style, label, onDelta, splitId, index }: ResizeHandleProps) {
  const cleanupRef = useRef<(() => void) | null>(null);
  useEffect(() => () => cleanupRef.current?.(), []);
  const begin = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (event.button !== 0) return;
    event.preventDefault();
    cleanupRef.current?.();
    const start = dir === "right" ? event.clientX : event.clientY;
    document.documentElement.dataset.workbenchResizing = "true";
    const move = (e: PointerEvent) => onDelta((dir === "right" ? e.clientX : e.clientY) - start);
    const cleanup = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", cleanup);
      window.removeEventListener("pointercancel", cleanup);
      delete document.documentElement.dataset.workbenchResizing;
      cleanupRef.current = null;
    };
    cleanupRef.current = cleanup;
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", cleanup);
    window.addEventListener("pointercancel", cleanup);
  };
  return (
    <div
      role="separator"
      aria-label={label}
      aria-orientation={dir === "right" ? "vertical" : "horizontal"}
      tabIndex={0}
      onPointerDown={begin}
      onKeyDown={(event) => {
        const negative = dir === "right" ? "ArrowLeft" : "ArrowUp";
        const positive = dir === "right" ? "ArrowRight" : "ArrowDown";
        if (event.key !== negative && event.key !== positive) return;
        event.preventDefault();
        onDelta((event.key === negative ? -1 : 1) * (event.shiftKey ? 64 : 16));
      }}
      className="workbench-sash"
      style={{ ...style, cursor: dir === "right" ? "col-resize" : "row-resize" }}
      data-sash-id={splitId}
      data-sash-index={index}
    />
  );
}

function SashHandle({
  splitId,
  index,
  dir,
  sizes,
  style,
  totalPx,
}: {
  splitId: string;
  index: number;
  dir: SplitDir;
  sizes: readonly number[];
  style: React.CSSProperties;
  totalPx: number;
}) {
  const setSplitRatio = useWorkbenchStore((s) => s.setSplitRatio);
  return (
    <ResizeHandle
      dir={dir}
      style={style}
      label="Pane size"
      splitId={splitId}
      index={index}
      onDelta={(delta) => {
        if (totalPx <= 0) return;
        const boundary = sizes.slice(0, index + 1).reduce((a, b) => a + b, 0);
        setSplitRatio(splitId, index, boundary + delta / totalPx);
      }}
    />
  );
}
