import { GripVerticalIcon } from "lucide-react";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
} from "react";
import { createPortal } from "react-dom";

import { MIN_PANE_HEIGHT } from "./scrollingLayout";
import { layoutLeaves, paneDropZoneFromPoint } from "./layout";
import { type ViewDragSource, type ViewDropTarget, type ViewDropResult } from "./workbenchState";
import { useWorkbenchStore } from "./workbenchStore";

export interface WorkbenchRect {
  readonly left: number;
  readonly top: number;
  readonly width: number;
  readonly height: number;
}

export type WorkbenchDragPhase = "dragging" | "canceling" | "rejected";

export interface WorkbenchDropResolver {
  readonly elementFromPoint: (x: number, y: number) => Element | null;
  readonly tabCount: () => number;
}

export interface WorkbenchDragState {
  readonly phase: WorkbenchDragPhase;
  readonly label: string;
  readonly pointer: { readonly x: number; readonly y: number };
  readonly startRect: WorkbenchRect;
  readonly target: ViewDropTarget | null;
  readonly result: ViewDropResult | null;
  readonly valid: boolean;
}

interface WorkbenchDragControllerValue {
  readonly beginDrag: (
    source: ViewDragSource,
    label: string,
    event: ReactPointerEvent<HTMLElement>,
  ) => void;
  readonly consumeSuppressedClick: () => boolean;
}

const DEFAULT_CONTROLLER: WorkbenchDragControllerValue = {
  beginDrag: () => {},
  consumeSuppressedClick: () => false,
};

const WorkbenchDragControllerContext =
  createContext<WorkbenchDragControllerValue>(DEFAULT_CONTROLLER);
const WorkbenchDragStateContext = createContext<WorkbenchDragState | null>(null);

const DRAG_THRESHOLD = 5;
const CANCEL_DURATION_MS = 180;

function rectFromElement(element: Element | null): WorkbenchRect | null {
  if (element === null) return null;
  const rect = element.getBoundingClientRect();
  return { left: rect.left, top: rect.top, width: rect.width, height: rect.height };
}

function elementForTarget(target: ViewDropTarget): Element | null {
  if (typeof document === "undefined") return null;
  if (target.kind === "pane") {
    const pane = document.querySelector<HTMLElement>(
      `[data-workbench-pane-drop][data-pane-id="${CSS.escape(target.paneId)}"]`,
    );
    if (pane !== null) return pane;
  }
  if (target.kind === "existingTab") {
    const tab = document.querySelector<HTMLElement>(
      `[data-workbench-tab-drop="${CSS.escape(target.tabId)}"]`,
    );
    if (tab !== null) return tab;
  }
  if (target.kind === "newTab") {
    return document.querySelector<HTMLElement>("[data-workbench-new-tab-drop]");
  }
  return null;
}

/** Resolve the semantic Workbench drop target under a viewport point. */
export function resolveWorkbenchDropTargetAtPoint(
  x: number,
  y: number,
  resolver?: WorkbenchDropResolver,
): ViewDropTarget | null {
  const resolved =
    resolver ??
    (typeof document === "undefined"
      ? null
      : {
          elementFromPoint: (pointX: number, pointY: number) =>
            document.elementFromPoint(pointX, pointY),
          tabCount: () => document.querySelectorAll("[data-workbench-tab-drop]").length,
        });
  if (resolved === null) return null;
  const element = resolved.elementFromPoint(x, y);
  if (element === null) return null;

  const newTabButton = element.closest<HTMLElement>("[data-workbench-new-tab-drop]");
  if (newTabButton !== null) {
    const rawIndex = newTabButton.dataset.workbenchNewTabDrop;
    const index = rawIndex === undefined || rawIndex === "end" ? Number.NaN : Number(rawIndex);
    const tabCount = resolved.tabCount();
    return { kind: "newTab", index: Number.isFinite(index) ? index : tabCount };
  }

  const existingTab = element.closest<HTMLElement>("[data-workbench-tab-drop]");
  const existingTabId = existingTab?.dataset.workbenchTabDrop;
  if (existingTabId !== undefined) return { kind: "existingTab", tabId: existingTabId };

  const pane = element.closest<HTMLElement>("[data-workbench-pane-drop]");
  const paneId = pane?.dataset.paneId;
  const tabId = pane?.dataset.workbenchTabId;
  if (pane !== null && paneId !== undefined && tabId !== undefined) {
    return {
      kind: "pane",
      tabId,
      paneId,
      zone: paneDropZoneFromPoint(x, y, pane.getBoundingClientRect()),
    };
  }

  const strip = element.closest<HTMLElement>("[data-workbench-tab-strip-drop]");
  if (strip !== null) {
    const tabs = Array.from(strip.querySelectorAll<HTMLElement>("[data-workbench-tab-drop]"));
    const index = tabs.findIndex((tab) => {
      const rect = tab.getBoundingClientRect();
      return x < rect.left + rect.width / 2;
    });
    return { kind: "newTab", index: index < 0 ? tabs.length : index };
  }

  return null;
}

function targetDestinationRect(
  target: ViewDropTarget,
): { readonly rect: WorkbenchRect; readonly paneId?: string } | null {
  const element = elementForTarget(target);
  const rect = rectFromElement(element);
  if (rect === null) return null;
  if (target.kind !== "pane") return { rect };
  if (target.zone === "replace") return { rect, paneId: target.paneId };
  const halfWidth = rect.width / 2;
  const halfHeight = rect.height / 2;
  const edgeRect: WorkbenchRect =
    target.zone === "left"
      ? { left: rect.left, top: rect.top, width: halfWidth, height: rect.height }
      : target.zone === "right"
        ? { left: rect.left + halfWidth, top: rect.top, width: halfWidth, height: rect.height }
        : target.zone === "top"
          ? { left: rect.left, top: rect.top, width: rect.width, height: halfHeight }
          : { left: rect.left, top: rect.top + halfHeight, width: rect.width, height: halfHeight };
  return { rect: edgeRect, paneId: target.paneId };
}

function sameTarget(a: ViewDropTarget | null, b: ViewDropTarget | null): boolean {
  if (a === null || b === null) return a === b;
  if (a.kind !== b.kind) return false;
  if (a.kind === "pane" && b.kind === "pane") {
    return a.tabId === b.tabId && a.paneId === b.paneId && a.zone === b.zone;
  }
  if (a.kind === "existingTab" && b.kind === "existingTab") return a.tabId === b.tabId;
  if (a.kind === "newTab" && b.kind === "newTab") return a.index === b.index;
  return false;
}

export function WorkbenchDragProvider({ children }: { readonly children: ReactNode }) {
  const [state, setState] = useState<WorkbenchDragState | null>(null);
  const suppressClickRef = useRef(false);
  const frameRef = useRef<number | null>(null);
  const stabilizeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const finishTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const activeRef = useRef(false);

  const consumeSuppressedClick = useCallback(() => {
    const suppressed = suppressClickRef.current;
    suppressClickRef.current = false;
    return suppressed;
  }, []);

  const clearFrame = useCallback(() => {
    if (frameRef.current === null) return;
    cancelAnimationFrame(frameRef.current);
    frameRef.current = null;
  }, []);

  const beginDrag = useCallback(
    (source: ViewDragSource, label: string, event: ReactPointerEvent<HTMLElement>) => {
      if (event.button !== 0 || event.defaultPrevented) return;
      const handle = event.currentTarget;
      const sourceElement =
        source.kind === "pane"
          ? document.querySelector<HTMLElement>(
              `[data-workbench-pane-drop][data-pane-id="${CSS.escape(source.paneId)}"]`,
            )
          : handle;
      const startRect = rectFromElement(sourceElement) ?? rectFromElement(handle);
      if (startRect === null) return;
      document.documentElement.dataset.workbenchDragging = "pending";

      if (finishTimerRef.current !== null) {
        clearTimeout(finishTimerRef.current);
        finishTimerRef.current = null;
      }
      clearFrame();
      activeRef.current = false;
      suppressClickRef.current = false;
      let lastX = event.clientX;
      let lastY = event.clientY;
      let lastTarget: ViewDropTarget | null = null;
      let lastResult: ViewDropResult | null = null;
      let publishedTarget: ViewDropTarget | null = null;

      const resolveTarget = (x: number, y: number) => {
        lastTarget = resolveWorkbenchDropTargetAtPoint(x, y);
        return lastTarget;
      };

      const previewFor = (target: ViewDropTarget | null) => {
        lastResult =
          target === null ? null : useWorkbenchStore.getState().previewDrop(source, target);
        return lastResult;
      };

      const publishPointer = () => {
        frameRef.current = null;
        const target = lastTarget;
        setState((current) => {
          if (current === null) return current;
          if (sameTarget(current.target, target)) {
            return current.pointer.x === lastX && current.pointer.y === lastY
              ? current
              : { ...current, pointer: { x: lastX, y: lastY } };
          }
          const result = previewFor(target);
          return {
            ...current,
            pointer: { x: lastX, y: lastY },
            target,
            result,
            valid: target !== null && result !== null,
          };
        });
      };

      const cleanup = () => {
        clearFrame();
        if (stabilizeTimerRef.current !== null) {
          clearTimeout(stabilizeTimerRef.current);
          stabilizeTimerRef.current = null;
        }
        window.removeEventListener("pointermove", onMove);
        window.removeEventListener("pointerup", onUp);
        window.removeEventListener("pointercancel", onCancel);
        window.removeEventListener("keydown", onKeyDown);
        delete document.documentElement.dataset.workbenchDragging;
      };

      const finish = (cancelled: boolean) => {
        const wasActive = activeRef.current;
        cleanup();
        if (!wasActive) return;
        activeRef.current = false;
        suppressClickRef.current = true;
        const liveTarget = cancelled ? null : resolveWorkbenchDropTargetAtPoint(lastX, lastY);
        const target = liveTarget;
        const result =
          target === null ? null : useWorkbenchStore.getState().previewDrop(source, target);
        if (!cancelled && target !== null && result !== null) {
          useWorkbenchStore.getState().commitDrop(result);
          setState(null);
          return;
        }
        const phase: WorkbenchDragPhase = cancelled ? "canceling" : "rejected";
        setState((current) =>
          current === null ? current : { ...current, phase, target, result: null, valid: false },
        );
        finishTimerRef.current = setTimeout(() => {
          finishTimerRef.current = null;
          setState(null);
        }, CANCEL_DURATION_MS);
      };

      const onMove = (moveEvent: PointerEvent) => {
        lastX = moveEvent.clientX;
        lastY = moveEvent.clientY;
        if (!activeRef.current) {
          if (Math.hypot(lastX - event.clientX, lastY - event.clientY) < DRAG_THRESHOLD) {
            return;
          }
          activeRef.current = true;
          document.documentElement.dataset.workbenchDragging = "true";
          window.getSelection()?.removeAllRanges();
          const target = resolveTarget(lastX, lastY);
          const result = previewFor(target);
          publishedTarget = target;
          setState({
            phase: "dragging",
            label,
            pointer: { x: lastX, y: lastY },
            startRect,
            target,
            result,
            valid: target !== null && result !== null,
          });
          return;
        }
        const target = resolveTarget(lastX, lastY);
        if (!sameTarget(publishedTarget, target)) publishedTarget = target;
        if (frameRef.current === null) frameRef.current = requestAnimationFrame(publishPointer);
        if (stabilizeTimerRef.current !== null) clearTimeout(stabilizeTimerRef.current);
        stabilizeTimerRef.current = setTimeout(() => {
          stabilizeTimerRef.current = null;
          resolveTarget(lastX, lastY);
          publishPointer();
        }, 180);
      };
      const onUp = () => finish(false);
      const onCancel = () => finish(true);
      const onKeyDown = (keyEvent: KeyboardEvent) => {
        if (keyEvent.key !== "Escape") return;
        keyEvent.preventDefault();
        finish(true);
      };

      window.addEventListener("pointermove", onMove);
      window.addEventListener("pointerup", onUp);
      window.addEventListener("pointercancel", onCancel);
      window.addEventListener("keydown", onKeyDown);
    },
    [clearFrame],
  );

  useEffect(
    () => () => {
      clearFrame();
      if (finishTimerRef.current !== null) clearTimeout(finishTimerRef.current);
      if (stabilizeTimerRef.current !== null) clearTimeout(stabilizeTimerRef.current);
      delete document.documentElement.dataset.workbenchDragging;
    },
    [clearFrame],
  );

  const controllerValue = useMemo(
    () => ({ beginDrag, consumeSuppressedClick }),
    [beginDrag, consumeSuppressedClick],
  );

  return (
    <WorkbenchDragControllerContext.Provider value={controllerValue}>
      <WorkbenchDragStateContext.Provider value={state}>
        {children}
      </WorkbenchDragStateContext.Provider>
    </WorkbenchDragControllerContext.Provider>
  );
}

export function useWorkbenchDragController(): WorkbenchDragControllerValue {
  return useContext(WorkbenchDragControllerContext);
}

export function useWorkbenchDragState(): WorkbenchDragState | null {
  return useContext(WorkbenchDragStateContext);
}

export function useWorkbenchDragSource(source: ViewDragSource, label: string) {
  const controller = useWorkbenchDragController();
  const onPointerDown = useCallback(
    (event: ReactPointerEvent<HTMLElement>) => controller.beginDrag(source, label, event),
    [controller, label, source],
  );
  return { onPointerDown, consumeSuppressedClick: controller.consumeSuppressedClick };
}

function targetFallbackRect(target: ViewDropTarget): WorkbenchRect | null {
  const element = elementForTarget(target);
  const rect = rectFromElement(element);
  if (rect === null) return null;
  return rect.width < 120 || rect.height < 40
    ? rect
    : (targetDestinationRect(target)?.rect ?? rect);
}

function tabInsertionMarker(target: ViewDropTarget): WorkbenchRect | null {
  if (typeof document === "undefined" || target.kind !== "newTab") return null;
  const strip = document.querySelector<HTMLElement>("[data-workbench-tab-strip-drop]");
  if (strip === null) return null;
  const tabs = Array.from(strip.querySelectorAll<HTMLElement>("[data-workbench-tab-drop]"));
  const index = Math.max(0, Math.min(target.index, tabs.length));
  const tabRect =
    index < tabs.length
      ? tabs[index]?.getBoundingClientRect()
      : tabs.at(-1)?.getBoundingClientRect();
  if (tabRect === undefined) return null;
  return {
    left: index < tabs.length ? tabRect.left - 1 : tabRect.right + 1,
    top: tabRect.top + 3,
    width: 2,
    height: Math.max(0, tabRect.height - 6),
  };
}

export function WorkbenchDropOverlay() {
  const state = useWorkbenchDragState();
  const isDragging = state !== null;
  const surfaceRef = useRef<HTMLDivElement>(null);
  const [surfaceRect, setSurfaceRect] = useState<WorkbenchRect | null>(null);

  useLayoutEffect(() => {
    if (!isDragging || surfaceRef.current === null) {
      setSurfaceRect(null);
      return;
    }
    setSurfaceRect(rectFromElement(surfaceRef.current));
  }, [isDragging]);

  if (state === null) return null;

  const preview = state.phase === "canceling" ? null : state.result;
  const previewTabId =
    preview === null || state.target === null
      ? null
      : state.target.kind === "newTab"
        ? preview.tabId
        : state.target.tabId;
  const previewTab =
    previewTabId === null
      ? null
      : (preview?.snapshot.tabs.find((tab) => tab.id === previewTabId) ?? null);
  const previewLeaves =
    previewTab === null || previewTab.layoutMode === "scrolling"
      ? []
      : layoutLeaves(previewTab.layout);
  const destinationLeaf =
    preview === null ? null : (previewLeaves.find((leaf) => leaf.id === preview.paneId) ?? null);

  let scrollingDestination: WorkbenchRect | null = null;
  if (previewTab?.layoutMode === "scrolling" && preview && surfaceRect) {
    const viewport = document.querySelector<HTMLElement>(".workbench-viewport");
    let left = surfaceRect.left - (viewport?.scrollLeft ?? 0);
    for (const column of previewTab.columns ?? []) {
      const index = column.paneIds.indexOf(preview.paneId);
      if (index >= 0) {
        const height = Math.max(
          surfaceRect.height,
          ...(previewTab.columns ?? []).flatMap((c) =>
            c.shares.map((share) => MIN_PANE_HEIGHT / share),
          ),
        );
        const before = column.shares.slice(0, index).reduce((a, b) => a + b, 0);
        scrollingDestination = {
          left: left + 5,
          top: surfaceRect.top + before * height - (viewport?.scrollTop ?? 0) + 5,
          width: column.width - 10,
          height: column.shares[index]! * height - 10,
        };
        break;
      }
      left += column.width + 8;
    }
  }
  const destinationRect =
    scrollingDestination ??
    (destinationLeaf !== null && surfaceRect !== null
      ? {
          left: surfaceRect.left + destinationLeaf.rect.x * surfaceRect.width + 5,
          top: surfaceRect.top + destinationLeaf.rect.y * surfaceRect.height + 5,
          width: destinationLeaf.rect.w * surfaceRect.width - 10,
          height: destinationLeaf.rect.h * surfaceRect.height - 10,
        }
      : state.target === null
        ? null
        : targetFallbackRect(state.target));

  const ghostRect =
    state.phase === "canceling"
      ? state.startRect
      : (destinationRect ?? {
          left: state.pointer.x - 84,
          top: state.pointer.y - 22,
          width: 168,
          height: 44,
        });
  const hasDestination = destinationRect !== null;
  const invalid = state.phase === "rejected" || (state.target !== null && !state.valid);
  const tabMarker = state.target === null ? null : tabInsertionMarker(state.target);

  return (
    <>
      <div
        ref={surfaceRef}
        className="pointer-events-none absolute inset-0 z-40 bg-background/15"
        data-workbench-drop-preview
        data-drop-phase={state.phase}
        data-drop-target-kind={state.target?.kind ?? "none"}
        data-drop-target-tab-id={
          state.target?.kind === "pane" || state.target?.kind === "existingTab"
            ? state.target.tabId
            : undefined
        }
      >
        {previewLeaves.map((leaf) => {
          const destination = destinationLeaf?.id === leaf.id;
          return (
            <div
              key={leaf.id}
              data-workbench-preview-pane
              data-pane-id={leaf.id}
              data-destination={destination ? "true" : "false"}
              className={
                "absolute rounded-md border transition-[left,top,width,height,background-color,border-color,opacity] duration-200 ease-out motion-reduce:transition-none " +
                (destination
                  ? "border-primary bg-primary/15 shadow-[0_0_0_1px_var(--color-primary)]"
                  : "border-border/80 bg-background/55")
              }
              style={{
                left: `calc(${leaf.rect.x * 100}% + 5px)`,
                top: `calc(${leaf.rect.y * 100}% + 5px)`,
                width: `calc(${leaf.rect.w * 100}% - 10px)`,
                height: `calc(${leaf.rect.h * 100}% - 10px)`,
              }}
            />
          );
        })}
      </div>
      {createPortal(
        <>
          {tabMarker === null ? null : (
            <div
              data-workbench-tab-drop-marker
              className="pointer-events-none fixed z-[99] rounded-full bg-primary shadow-[0_0_8px_var(--color-primary)]"
              style={{
                left: tabMarker.left,
                top: tabMarker.top,
                width: tabMarker.width,
                height: tabMarker.height,
              }}
            />
          )}
          <div
            data-workbench-drag-ghost
            data-phase={state.phase}
            data-valid={invalid ? "false" : "true"}
            className={
              "pointer-events-none fixed z-[100] flex items-center gap-2 overflow-hidden rounded-lg border bg-background/95 px-3 shadow-xl backdrop-blur-sm will-change-transform " +
              "transition-[transform,width,height,border-color,opacity] ease-out motion-reduce:transition-none " +
              (invalid
                ? "border-destructive text-destructive "
                : "border-primary text-foreground ") +
              (state.phase === "canceling" ? "opacity-0" : "opacity-100")
            }
            style={{
              left: 0,
              top: 0,
              width: ghostRect.width,
              height: ghostRect.height,
              transform: `translate3d(${ghostRect.left}px, ${ghostRect.top}px, 0)`,
              transitionDuration: hasDestination ? "200ms" : "80ms",
            }}
          >
            <GripVerticalIcon className="size-3.5 shrink-0 text-muted-foreground" />
            <span className="min-w-0 flex-1 truncate text-xs font-medium">{state.label}</span>
          </div>
        </>,
        document.body,
      )}
    </>
  );
}
