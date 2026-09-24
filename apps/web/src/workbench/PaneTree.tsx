import {
  memo,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
} from "react";
import { CopyPlusIcon } from "lucide-react";

import type { EnvironmentAwenProject } from "@awen/client-runtime/state/models";
import type { PaneShadow } from "@awen/contracts/settings";
import { usePrimarySettings } from "../hooks/useSettings";
import { readLocalApi } from "../localApi";
import type { SplitDir } from "./layout";
import { computePaneLayoutRects } from "./layoutGeometry";
import { MIN_PANE_HEIGHT } from "./scrollingLayout";
import { resolveViewDefinition, type ViewTarget } from "./viewRegistry";
import { useWorkbenchStore } from "./workbenchStore";
import type { WorkbenchSnapshot, WorkbenchTab } from "./workbenchState";
import { useWorkbenchDragState, useWorkbenchDragSource } from "./workbenchDrag";
import { resolveTargetBreadcrumbs } from "./workbenchTitles";
import {
  animateScrollTo,
  cancelActiveScrollAnimation,
  computeScrollingRevealTarget,
} from "./scrollingAnimation";

interface PaneTreeProps {
  readonly snapshot: WorkbenchSnapshot;
  readonly projects?: ReadonlyArray<EnvironmentAwenProject>;
}

const EMPTY_PROJECTS: ReadonlyArray<EnvironmentAwenProject> = [];

function resolvePaneBoxShadow(paneGap: number, paneShadow: PaneShadow): string {
  if (paneGap === 0) return "none";
  switch (paneShadow) {
    case "subtle":
      return "0 1px 3px rgba(0, 0, 0, 0.08), 0 1px 2px rgba(0, 0, 0, 0.04)";
    case "medium":
      return "0 4px 14px rgba(0, 0, 0, 0.12), 0 1px 3px rgba(0, 0, 0, 0.06)";
    case "elevated":
      return "0 14px 32px rgba(0, 0, 0, 0.18), 0 2px 8px rgba(0, 0, 0, 0.08)";
    case "none":
    default:
      return "none";
  }
}

/**
 * Workbench canvas host that maintains Keep-Alive viewports across all tabs.
 * Switching tabs is an instant 0ms CSS visibility toggle without DOM unmounting.
 */
export function PaneTree({ snapshot, projects = EMPTY_PROJECTS }: PaneTreeProps) {
  return (
    <div className="workbench-viewport-container relative flex flex-1 min-h-0 min-w-0 flex-col">
      {snapshot.tabs.map((tab) => (
        <TabPaneTree
          key={tab.id}
          tab={tab}
          snapshot={snapshot}
          projects={projects}
          isActive={tab.id === snapshot.activeTabId}
        />
      ))}
    </div>
  );
}

interface TabPaneTreeProps {
  readonly tab: WorkbenchTab;
  readonly snapshot: WorkbenchSnapshot;
  readonly projects: ReadonlyArray<EnvironmentAwenProject>;
  readonly isActive: boolean;
}

const TabPaneTree = memo(
  function TabPaneTree({ tab, snapshot, projects, isActive }: TabPaneTreeProps) {
    const dragState = useWorkbenchDragState();
    const previewTab =
      isActive && dragState?.phase === "dragging" && dragState.valid
        ? dragState.result?.snapshot.tabs.find((candidate) => candidate.id === tab.id)
        : undefined;
    const scrolling = tab.layoutMode === "scrolling";
    const viewportRef = useRef<HTMLDivElement>(null);
    const [size, setSize] = useState({ width: 0, height: 0 });
    const changeColumn = useWorkbenchStore((s) => s.changeColumn);
    const setFocused = useWorkbenchStore((s) => s.setFocused);
    const previousRects = useRef(new Map<string, DOMRect>());

    const paneGap = usePrimarySettings((s) => s.paneGap);
    const paneRadius = usePrimarySettings((s) => s.paneRadius);
    const paneShadow = usePrimarySettings((s) => s.paneShadow);

    useLayoutEffect(() => {
      if (!isActive || scrolling) return;
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
          document.documentElement.dataset.workbenchDragging ||
          window.matchMedia("(prefers-reduced-motion: reduce)").matches
        )
          continue;
        const dx = old.left - rect.left;
        const dy = old.top - rect.top;
        if (Math.abs(dx) + Math.abs(dy) > 1) {
          frame.getAnimations().forEach((animation) => animation.cancel());
          frame.animate(
            [
              { transform: "translate(" + dx + "px," + dy + "px)" },
              { transform: "translate(0,0)" },
            ],
            { duration: 220, easing: "cubic-bezier(0.22, 1, 0.36, 1)" },
          );
        }
      }
      previousRects.current = next;
    }, [isActive, scrolling, tab.layout]);

    useEffect(() => {
      const element = viewportRef.current;
      if (!element) return;
      const update = () => {
        if (element.clientWidth > 0 && element.clientHeight > 0) {
          setSize({ width: element.clientWidth, height: element.clientHeight });
        }
      };
      update();
      const observer = new ResizeObserver(update);
      observer.observe(element);
      return () => observer.disconnect();
    }, [isActive]);

    useEffect(() => {
      const viewport = viewportRef.current;
      if (!isActive || !scrolling || !viewport) return;
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
    }, [isActive, scrolling]);

    const previousTabIdRef = useRef(tab.id);
    const previousSizeRef = useRef(size);
    const isInitialMountRef = useRef(true);

    const layout = useMemo(() => computePaneLayoutRects(tab, size, paneGap), [tab, size, paneGap]);

    const previewLayout = useMemo(
      () => (previewTab ? computePaneLayoutRects(previewTab, size, paneGap) : undefined),
      [previewTab, size, paneGap],
    );

    useLayoutEffect(() => {
      if (!isActive || !previewLayout) return;
      const viewport = viewportRef.current;
      if (!viewport?.querySelectorAll) return;
      const frames = viewport.querySelectorAll<HTMLElement>(".workbench-pane-frame");
      const capturedRects = new Map<string, DOMRect>();
      for (const frame of frames) {
        const id =
          frame.querySelector<HTMLElement>("[data-view-instance-id]")?.dataset.viewInstanceId;
        if (!id) continue;
        capturedRects.set(id, frame.getBoundingClientRect());
      }
      for (const frame of frames) {
        const id =
          frame.querySelector<HTMLElement>("[data-view-instance-id]")?.dataset.viewInstanceId;
        if (!id) continue;
        const oldRect = capturedRects.get(id);
        const newRect = frame.getBoundingClientRect();
        if (!oldRect) continue;
        const dx = oldRect.left - newRect.left;
        const dy = oldRect.top - newRect.top;
        if (Math.abs(dx) + Math.abs(dy) > 1) {
          frame.getAnimations().forEach((animation) => animation.cancel());
          frame.animate(
            [
              { transform: "translate(" + dx + "px," + dy + "px)" },
              { transform: "translate(0,0)" },
            ],
            { duration: 220, easing: "cubic-bezier(0.22, 1, 0.36, 1)" },
          );
        }
      }
    }, [isActive, previewLayout]);

    useLayoutEffect(() => {
      if (!isActive) return;
      const viewport = viewportRef.current;
      if (!scrolling || !viewport) return;

      if (dragState?.phase === "dragging" || document.documentElement.dataset.workbenchResizing) {
        return;
      }

      const rect = layout.rects.get(tab.focusedPaneId);
      if (!rect) return;

      const target = computeScrollingRevealTarget({
        isSingleColumn: (tab.columns ?? []).length <= 1,
        rect,
        paneGap,
        canvasWidth: layout.canvasWidth,
        canvasHeight: layout.canvasHeight,
        viewportWidth: viewport.clientWidth,
        viewportHeight: viewport.clientHeight,
        currentScrollLeft: viewport.scrollLeft,
        currentScrollTop: viewport.scrollTop,
      });

      if (!target) return;

      const isTabSwitch = previousTabIdRef.current !== tab.id;
      previousTabIdRef.current = tab.id;

      const isWindowResize =
        previousSizeRef.current.width !== size.width ||
        previousSizeRef.current.height !== size.height;
      previousSizeRef.current = size;

      const isInitialMount = isInitialMountRef.current;
      isInitialMountRef.current = false;

      if (!target.needsScroll) return;

      if (
        isInitialMount ||
        isTabSwitch ||
        isWindowResize ||
        window.matchMedia?.("(prefers-reduced-motion: reduce)").matches
      ) {
        cancelActiveScrollAnimation(viewport);
        viewport.scrollLeft = target.targetLeft;
        viewport.scrollTop = target.targetTop;
        return;
      }

      return animateScrollTo(viewport, target.targetLeft, target.targetTop);
    }, [
      isActive,
      scrolling,
      tab.id,
      tab.focusedPaneId,
      tab.columns,
      layout,
      size,
      paneGap,
      dragState?.phase,
    ]);

    useEffect(() => {
      if (!isActive) return;
      const viewport = viewportRef.current;
      if (!viewport?.querySelector) return;
      const pane = viewport.querySelector<HTMLElement>(
        `[data-pane-id="${tab.focusedPaneId}"] .workbench-pane`,
      );
      pane?.focus({ preventScroll: true });
    }, [isActive, tab.focusedPaneId]);

    const activeLayout = previewLayout ?? layout;
    const canvasStyle = {
      width: Math.max(activeLayout.canvasWidth, size.width),
      height: activeLayout.canvasHeight,
      "--pane-gap": `${paneGap}px`,
      "--pane-radius": `${paneRadius}px`,
      "--pane-shadow": resolvePaneBoxShadow(paneGap, paneShadow),
    } as React.CSSProperties;

    return (
      <div
        ref={viewportRef}
        className="workbench-viewport"
        style={{ display: isActive ? undefined : "none" }}
        data-tab-id={tab.id}
        data-tab-active={isActive ? "true" : "false"}
        data-layout-mode={scrolling ? "scrolling" : "bsp"}
        aria-hidden={!isActive}
      >
        <div className="workbench-canvas" style={canvasStyle}>
          {[...tab.panes].map(([paneId, view]) => {
            const current = layout.rects.get(paneId);
            const preview = previewLayout?.rects.get(paneId);
            const targetRect = preview ?? current;
            const isDraggedPane =
              dragState?.phase === "dragging" &&
              dragState.source.kind === "pane" &&
              dragState.source.paneId === paneId;
            return (
              <div
                key={view.id}
                className="workbench-pane-frame"
                style={targetRect}
                onMouseDownCapture={(event) => {
                  if (paneId !== tab.focusedPaneId) {
                    setFocused(paneId);
                    if (typeof document !== "undefined") {
                      const activeEl = document.activeElement;
                      if (
                        activeEl &&
                        typeof (activeEl as { blur?: unknown }).blur === "function" &&
                        typeof (activeEl as { closest?: unknown }).closest === "function"
                      ) {
                        const activePane = (activeEl as HTMLElement).closest<HTMLElement>(
                          ".workbench-pane",
                        );
                        if (activePane && activePane.dataset.paneId !== paneId) {
                          (activeEl as HTMLElement).blur();
                          if (typeof window !== "undefined") {
                            window.getSelection()?.removeAllRanges();
                          }
                        }
                      }
                    }
                    const targetElement = event?.target as HTMLElement | null | undefined;
                    const isInteractive = Boolean(
                      targetElement?.closest?.(
                        'input, textarea, [contenteditable="true"], button, a, select, [role="button"], [role="menuitem"]',
                      ),
                    );
                    if (!isInteractive && event?.currentTarget?.querySelector) {
                      const pane =
                        event.currentTarget.querySelector<HTMLElement>(".workbench-pane");
                      pane?.focus({ preventScroll: true });
                    }
                  }
                }}
              >
                <div
                  className="workbench-pane-preview"
                  data-previewing={Boolean(previewTab)}
                  style={{
                    opacity: previewTab && !preview ? 0.2 : isDraggedPane ? 0.5 : undefined,
                  }}
                >
                  <Pane
                    tab={tab}
                    projects={projects}
                    paneId={paneId}
                    focused={isActive && paneId === tab.focusedPaneId}
                  />
                </div>
              </div>
            );
          })}

          {layout.sashes.map((sash) => {
            if (sash.isColumnWidth) {
              const column = (tab.columns ?? []).find((c) => c.id === sash.columnId);
              if (!column) return null;
              return (
                <ResizeHandle
                  key={sash.id}
                  label={sash.label}
                  dir={sash.dir}
                  style={{
                    left: sash.left,
                    top: sash.top,
                    width: sash.width,
                    height: sash.height,
                  }}
                  onDelta={(delta) => changeColumn(column.id, { width: column.width + delta })}
                />
              );
            }
            if (sash.isPaneHeight) {
              const column = (tab.columns ?? []).find((c) => c.id === sash.columnId);
              if (!column || sash.paneIndex === undefined) return null;
              const index = sash.paneIndex;
              return (
                <ResizeHandle
                  key={sash.id}
                  label={sash.label}
                  dir={sash.dir}
                  style={{
                    left: sash.left,
                    top: sash.top,
                    width: sash.width,
                    height: sash.height,
                  }}
                  onDelta={(delta) => {
                    const shares = [...column.shares];
                    const a = shares[index]!;
                    const b = shares[index + 1]!;
                    const totalPx = sash.totalPx ?? layout.canvasHeight;
                    if (totalPx <= 0) return;
                    const min = Math.min(MIN_PANE_HEIGHT / totalPx, (a + b) / 2);
                    const next = Math.max(min, Math.min(a + b - min, a + delta / totalPx));
                    shares[index] = next;
                    shares[index + 1] = a + b - next;
                    changeColumn(column.id, { shares });
                  }}
                />
              );
            }
            if (sash.splitId && sash.index !== undefined && sash.sizes) {
              return (
                <SashHandle
                  key={sash.id}
                  splitId={sash.splitId}
                  index={sash.index}
                  dir={sash.dir}
                  sizes={sash.sizes}
                  style={{
                    left: sash.left,
                    top: sash.top,
                    width: sash.width,
                    height: sash.height,
                  }}
                  totalPx={sash.totalPx ?? layout.canvasWidth}
                />
              );
            }
            return null;
          })}
        </div>
      </div>
    );
  },
  (prev, next) => {
    if (prev.isActive !== next.isActive) return false;
    if (prev.tab !== next.tab) return false;
    if (prev.projects !== next.projects) return false;
    return true;
  },
);

interface PaneProps {
  readonly tab: WorkbenchTab;
  readonly projects: ReadonlyArray<EnvironmentAwenProject>;
  readonly paneId: string;
  readonly focused: boolean;
}

function Pane({ tab, projects, paneId, focused }: PaneProps) {
  const setFocused = useWorkbenchStore((s) => s.setFocused);
  const focusRequestId = useWorkbenchStore((s) => s.focusRequestId);
  const closeView = useWorkbenchStore((s) => s.closeView);
  const requestClosePane = useWorkbenchStore((s) => s.requestClosePane);
  const duplicateToNewTab = useWorkbenchStore((s) => s.duplicateToNewTab);
  const view = tab.panes.get(paneId);
  const target = view?.target ?? null;
  const definition = target === null ? null : resolveViewDefinition(target);
  const breadcrumbs =
    target === null ? ["Unavailable View"] : resolveTargetBreadcrumbs(target, projects);
  const drag = useWorkbenchDragSource(
    { kind: "pane", tabId: tab.id, paneId },
    breadcrumbs.at(-1) ?? "View",
  );

  const onClick = useCallback(() => {
    if (!focused) setFocused(paneId);
  }, [focused, paneId, setFocused]);

  const onPaneFocus = useCallback(
    (event?: React.FocusEvent<HTMLDivElement>) => {
      if (focused) return;
      if (
        !event?.currentTarget ||
        typeof document === "undefined" ||
        (document.activeElement &&
          event.currentTarget.contains(document.activeElement) &&
          (document.activeElement as HTMLElement).closest<HTMLElement>(".workbench-pane")?.dataset
            .paneId === paneId)
      ) {
        setFocused(paneId);
      }
    },
    [focused, paneId, setFocused],
  );

  const onDuplicate = () => {
    duplicateToNewTab({ kind: "pane", tabId: tab.id, paneId });
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
      if (!entry) return;
      const { width, height } = entry.contentRect;
      update({ width: Math.round(width), height: Math.round(height) });
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, [definition]);

  return (
    <div
      role="region"
      aria-label={target !== null ? `Pane ${target.kind}` : "Unavailable View"}
      tabIndex={-1}
      onMouseDown={onClick}
      onFocus={onPaneFocus}
      className={"workbench-pane flex h-full min-h-0 min-w-0 flex-1 flex-col outline-none"}
      data-pane-id={paneId}
      data-workbench-pane-drop=""
      data-workbench-tab-id={tab.id}
      data-view-instance-id={view?.id}
      data-pane-focused={focused}
      data-pane-target-kind={target?.kind ?? "empty"}
    >
      <PaneHeader
        paneId={paneId}
        breadcrumbs={breadcrumbs}
        focused={focused}
        onDragStart={drag.onPointerDown}
        onDuplicate={onDuplicate}
        onOpenMenu={openPaneMenu}
        onClose={() => void requestClosePane(paneId)}
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
  breadcrumbs,
  focused,
  onDragStart,
  onDuplicate,
  onOpenMenu,
  onClose,
}: {
  readonly paneId: string;
  readonly breadcrumbs: readonly string[];
  readonly focused: boolean;
  readonly onDragStart: (event: ReactPointerEvent<HTMLElement>) => void;
  readonly onDuplicate: () => void;
  readonly onOpenMenu: (position: { readonly x: number; readonly y: number }) => void;
  readonly onClose: () => void;
}) {
  return (
    <div
      tabIndex={0}
      role="toolbar"
      aria-label="Pane header"
      data-pane-header-focused={focused}
      data-workbench-pane-drag-handle=""
      className="flex select-none items-center justify-between px-3 py-1.5 text-xs touch-none cursor-grab active:cursor-grabbing"
      onMouseDown={(event) => {
        const targetElement = event.target as HTMLElement;
        if (targetElement.closest("button") === null) {
          event.preventDefault();
          event?.currentTarget
            ?.closest?.<HTMLElement>(".workbench-pane")
            ?.focus({ preventScroll: true });
        }
      }}
      onPointerDown={(event) => {
        const targetElement = event.target as HTMLElement;
        if (targetElement.closest("button") !== null) {
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
        Rendering view for {target.kind}...
      </div>
    );
  }
  return (
    <div className="flex h-full min-h-0 items-center justify-center p-6 text-sm text-muted-foreground">
      View unavailable.
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
