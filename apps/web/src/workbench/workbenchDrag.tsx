import { MessageSquarePlusIcon, TerminalIcon, CopyPlusIcon } from "lucide-react";
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

import { paneDropZoneFromPoint } from "./layout";
import { computePaneLayoutRects } from "./layoutGeometry";
import { usePrimarySettings } from "../hooks/useSettings";
import { useUiStateStore } from "../uiStateStore";
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

export interface SidebarDropTarget {
  readonly workspaceKey: string;
  readonly sessionId: string;
  readonly position: "before" | "after";
}

export interface WorkbenchDragState {
  readonly phase: WorkbenchDragPhase;
  readonly label: string;
  readonly source: ViewDragSource;
  readonly pointer: { readonly x: number; readonly y: number };
  readonly startRect: WorkbenchRect;
  readonly target: ViewDropTarget | null;
  readonly result: ViewDropResult | null;
  readonly valid: boolean;
  readonly isOverSidebar: boolean;
  readonly sidebarDropTarget: SidebarDropTarget | null;
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

export function resolveSidebarDropTargetAtPoint(
  x: number,
  y: number,
  sourceWorkspaceKey: string,
  sourceSessionId: string,
  resolver?: {
    readonly isOverSidebar: (x: number, y: number) => boolean;
    readonly elementFromPoint: (x: number, y: number) => Element | null;
  },
): { readonly isOverSidebar: boolean; readonly sidebarDropTarget: SidebarDropTarget | null } {
  const isOver =
    resolver?.isOverSidebar(x, y) ??
    (() => {
      if (typeof document === "undefined") return false;
      const sidebarElement =
        document.querySelector<HTMLElement>("[data-app-sidebar]") ??
        document.querySelector<HTMLElement>('[data-slot="sidebar"]');
      const rect = sidebarElement?.getBoundingClientRect();
      return (
        rect !== undefined &&
        x >= rect.left &&
        x <= rect.right &&
        y >= rect.top &&
        y <= rect.bottom
      );
    })();

  if (!isOver) return { isOverSidebar: false, sidebarDropTarget: null };

  const element =
    resolver?.elementFromPoint(x, y) ??
    (typeof document === "undefined" ? null : document.elementFromPoint(x, y));
  const rowElement = element?.closest<HTMLElement>("[data-sidebar-session-row]");
  if (rowElement) {
    const rowWorkspaceKey = rowElement.dataset.workspaceKey;
    const rowSessionId = rowElement.dataset.sessionId;
    if (
      rowWorkspaceKey === sourceWorkspaceKey &&
      rowSessionId &&
      rowSessionId !== sourceSessionId
    ) {
      const rowRect = rowElement.getBoundingClientRect();
      const position = y < rowRect.top + rowRect.height / 2 ? "before" : "after";
      return {
        isOverSidebar: true,
        sidebarDropTarget: {
          workspaceKey: rowWorkspaceKey,
          sessionId: rowSessionId,
          position,
        },
      };
    }
  }

  return { isOverSidebar: true, sidebarDropTarget: null };
}

export function WorkbenchDragProvider({ children }: { readonly children: ReactNode }) {
  const [state, setState] = useState<WorkbenchDragState | null>(null);
  const suppressClickRef = useRef(false);
  const frameRef = useRef<number | null>(null);
  const stabilizeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const finishTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const activeRef = useRef(false);
  const cleanupDragRef = useRef<(() => void) | null>(null);

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
      cleanupDragRef.current?.();
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
      let lastIsOverSidebar = false;
      let lastSidebarDropTarget: SidebarDropTarget | null = null;
      let publishedTarget: ViewDropTarget | null = null;

      // Preview transforms never move the semantic drop regions beneath the pointer.
      const paneRegions = Array.from(
        document.querySelectorAll<HTMLElement>("[data-workbench-pane-drop]"),
      ).map((element) => ({ element, rect: element.getBoundingClientRect() }));
      const resolveTarget = (x: number, y: number) => {
        const actual = resolveWorkbenchDropTargetAtPoint(x, y);
        if (actual && actual.kind !== "pane") {
          lastTarget = actual;
          return actual;
        }
        const viewport = document
          .querySelector<HTMLElement>(".workbench-viewport")
          ?.getBoundingClientRect();
        const inside =
          viewport &&
          x >= viewport.left &&
          x <= viewport.right &&
          y >= viewport.top &&
          y <= viewport.bottom;
        const hit = inside
          ? paneRegions.find(
              ({ rect }) => x >= rect.left && x <= rect.right && y >= rect.top && y <= rect.bottom,
            )
          : undefined;
        lastTarget = hit
          ? {
              kind: "pane",
              tabId: hit.element.dataset.workbenchTabId!,
              paneId: hit.element.dataset.paneId!,
              zone: paneDropZoneFromPoint(x, y, hit.rect),
            }
          : actual;
        return lastTarget;
      };

      const previewFor = (target: ViewDropTarget | null) => {
        lastResult =
          target === null ? null : useWorkbenchStore.getState().previewDrop(source, target);
        return lastResult;
      };

      const publishPointer = () => {
        frameRef.current = null;
        const target = lastIsOverSidebar ? null : lastTarget;
        setState((current) => {
          if (current === null) return current;
          if (sameTarget(current.target, target) && current.isOverSidebar === lastIsOverSidebar && current.sidebarDropTarget === lastSidebarDropTarget) {
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
            isOverSidebar: lastIsOverSidebar,
            sidebarDropTarget: lastSidebarDropTarget,
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
        cleanupDragRef.current = null;
      };
      cleanupDragRef.current = cleanup;

      const finish = (cancelled: boolean) => {
        const wasActive = activeRef.current;
        const currentSidebarDropTarget = lastSidebarDropTarget;
        const currentIsOverSidebar = lastIsOverSidebar;
        cleanup();
        if (!wasActive) return;
        activeRef.current = false;
        suppressClickRef.current = true;

        if (!cancelled && source.kind === "sidebar" && currentIsOverSidebar && currentSidebarDropTarget) {
          const sourceSessionId =
            source.target.kind === "agentSession"
              ? source.target.agentSessionId
              : source.target.terminalSessionId;
          const workspaceKey = `${source.target.environmentId}:${source.target.workspaceId}`;
          const allSessionRows = Array.from(
            document.querySelectorAll<HTMLElement>(
              `[data-sidebar-session-row][data-workspace-key="${CSS.escape(workspaceKey)}"]`,
            ),
          )
            .map((el) => el.dataset.sessionId)
            .filter((id): id is string => Boolean(id));

          useUiStateStore.getState().reorderWorkspaceSessions(
            workspaceKey,
            allSessionRows,
            sourceSessionId,
            currentSidebarDropTarget.sessionId,
            currentSidebarDropTarget.position,
          );
          setState(null);
          return;
        }

        const liveTarget = cancelled || currentIsOverSidebar ? null : resolveTarget(lastX, lastY);
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
          current === null
            ? current
            : {
                ...current,
                phase,
                target,
                result: null,
                valid: false,
                isOverSidebar: currentIsOverSidebar,
                sidebarDropTarget: null,
              },
        );
        finishTimerRef.current = setTimeout(() => {
          finishTimerRef.current = null;
          setState(null);
        }, CANCEL_DURATION_MS);
      };

      const checkSidebarState = (x: number, y: number) => {
        if (source.kind !== "sidebar") {
          return { isOverSidebar: false, sidebarDropTarget: null };
        }
        const sourceWorkspaceKey = `${source.target.environmentId}:${source.target.workspaceId}`;
        const sourceSessionId =
          source.target.kind === "agentSession"
            ? source.target.agentSessionId
            : source.target.terminalSessionId;
        const res = resolveSidebarDropTargetAtPoint(x, y, sourceWorkspaceKey, sourceSessionId);
        lastIsOverSidebar = res.isOverSidebar;
        lastSidebarDropTarget = res.sidebarDropTarget;
        return res;
      };

      const onMove = (moveEvent: PointerEvent) => {
        lastX = moveEvent.clientX;
        lastY = moveEvent.clientY;
        const { isOverSidebar, sidebarDropTarget } = checkSidebarState(lastX, lastY);

        if (!activeRef.current) {
          if (Math.hypot(lastX - event.clientX, lastY - event.clientY) < DRAG_THRESHOLD) {
            return;
          }
          activeRef.current = true;
          document.documentElement.dataset.workbenchDragging = "true";
          window.getSelection()?.removeAllRanges();
          const target = isOverSidebar ? null : resolveTarget(lastX, lastY);
          const result = isOverSidebar ? null : previewFor(target);
          publishedTarget = target;
          setState({
            phase: "dragging",
            label,
            source,
            pointer: { x: lastX, y: lastY },
            startRect,
            target,
            result,
            valid: target !== null && result !== null,
            isOverSidebar,
            sidebarDropTarget,
          });
          return;
        }

        const target = isOverSidebar ? null : resolveTarget(lastX, lastY);
        if (!sameTarget(publishedTarget, target)) publishedTarget = target;
        if (frameRef.current === null) frameRef.current = requestAnimationFrame(publishPointer);
        if (stabilizeTimerRef.current !== null) clearTimeout(stabilizeTimerRef.current);
        stabilizeTimerRef.current = setTimeout(() => {
          stabilizeTimerRef.current = null;
          if (!lastIsOverSidebar) resolveTarget(lastX, lastY);
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
      cleanupDragRef.current?.();
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

function dragGhostInfo(source: ViewDragSource): { readonly icon: ReactNode; readonly typeLabel: string } {
  if (source.kind === "sidebar") {
    if (source.target.kind === "agentSession") {
      return {
        icon: <MessageSquarePlusIcon className="size-5 text-primary" />,
        typeLabel: "Agent Session",
      };
    }
    if (source.target.kind === "workspaceTerminal") {
      return {
        icon: <TerminalIcon className="size-5 text-primary" />,
        typeLabel: "Terminal Session",
      };
    }
  } else if (source.kind === "pane") {
    const tab = useWorkbenchStore.getState().tabs.find((t) => t.id === source.tabId);
    const pane = tab?.panes.get(source.paneId);
    if (pane?.target.kind === "agentSession") {
      return {
        icon: <MessageSquarePlusIcon className="size-5 text-primary" />,
        typeLabel: "Agent Session",
      };
    }
    if (pane?.target.kind === "workspaceTerminal") {
      return {
        icon: <TerminalIcon className="size-5 text-primary" />,
        typeLabel: "Terminal Session",
      };
    }
  }
  return {
    icon: <CopyPlusIcon className="size-5 text-primary" />,
    typeLabel: "View",
  };
}

export function WorkbenchDropOverlay() {
  const state = useWorkbenchDragState();
  const paneGap = usePrimarySettings((s) => s.paneGap);
  const paneRadius = usePrimarySettings((s) => s.paneRadius);
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

  const preview = state === null || state.phase === "canceling" ? null : state.result;
  const previewTabId =
    state === null || preview === null || state.target === null
      ? null
      : state.target.kind === "newTab"
        ? preview.tabId
        : state.target.tabId;
  const previewTab =
    previewTabId === null
      ? null
      : (preview?.snapshot.tabs.find((tab) => tab.id === previewTabId) ?? null);

  const previewLayout = useMemo(() => {
    if (!previewTab || !surfaceRect) return null;
    return computePaneLayoutRects(previewTab, surfaceRect, paneGap);
  }, [previewTab, surfaceRect, paneGap]);

  if (state === null || state.isOverSidebar) return null;

  let destinationRect: WorkbenchRect | null = null;
  if (preview && previewLayout && surfaceRect) {
    const rect = previewLayout.rects.get(preview.paneId);
    if (rect) {
      const viewport = document.querySelector<HTMLElement>(".workbench-viewport");
      const scrollLeft = previewTab?.layoutMode === "scrolling" ? (viewport?.scrollLeft ?? 0) : 0;
      const scrollTop = viewport?.scrollTop ?? 0;
      destinationRect = {
        left: surfaceRect.left + rect.left - scrollLeft,
        top: surfaceRect.top + rect.top - scrollTop,
        width: rect.width,
        height: rect.height,
      };
    }
  }
  if (!destinationRect && state.target !== null) {
    destinationRect = targetFallbackRect(state.target);
  }

  const GHOST_WIDTH = 156;
  const GHOST_HEIGHT = 84;
  const ghostRect =
    state.phase === "canceling"
      ? {
          left: state.startRect.left,
          top: state.startRect.top,
          width: GHOST_WIDTH,
          height: GHOST_HEIGHT,
        }
      : {
          left: state.pointer.x - GHOST_WIDTH / 2,
          top: state.pointer.y - GHOST_HEIGHT / 2,
          width: GHOST_WIDTH,
          height: GHOST_HEIGHT,
        };
  const invalid = state.phase === "rejected" || (state.target !== null && !state.valid);
  const tabMarker = state.target === null ? null : tabInsertionMarker(state.target);
  const ghostInfo = dragGhostInfo(state.source);

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
        {previewLayout
          ? [...previewLayout.rects.entries()].map(([paneId, rect]) => {
              const destination = preview?.paneId === paneId;
              return (
                <div
                  key={paneId}
                  data-workbench-preview-pane
                  data-pane-id={paneId}
                  data-destination={destination ? "true" : "false"}
                  className={
                    "absolute border transition-[left,top,width,height,background-color,border-color,opacity] duration-200 ease-out motion-reduce:transition-none " +
                    (destination
                      ? "border-2 border-primary bg-primary/15 shadow-[0_0_0_1px_var(--color-primary)]"
                      : "border border-border/80 bg-background/55")
                  }
                  style={{
                    left: `${rect.left}px`,
                    top: `${rect.top}px`,
                    width: `${rect.width}px`,
                    height: `${rect.height}px`,
                    borderRadius: `${paneRadius}px`,
                  }}
                />
              );
            })
          : null}
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
              "pointer-events-none fixed z-[100] flex flex-col items-center justify-center overflow-hidden rounded-xl border p-2.5 shadow-2xl backdrop-blur-md will-change-transform " +
              "transition-[opacity,border-color] ease-out motion-reduce:transition-none " +
              (invalid
                ? "border-destructive/80 bg-destructive/15 text-destructive "
                : "border-border/80 bg-background/85 text-foreground ") +
              (state.phase === "canceling" ? "opacity-0 duration-180" : "opacity-100 duration-75")
            }
            style={{
              left: 0,
              top: 0,
              width: `${ghostRect.width}px`,
              height: `${ghostRect.height}px`,
              transform: `translate3d(${ghostRect.left}px, ${ghostRect.top}px, 0)`,
            }}
          >
            <div className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
              {ghostInfo.icon}
            </div>
            <div className="flex flex-col items-center min-w-0 max-w-full mt-1.5">
              <span className="truncate max-w-[136px] text-xs font-semibold text-foreground leading-tight text-center">
                {state.label}
              </span>
              <span className="text-[10px] text-muted-foreground font-medium leading-tight mt-0.5 text-center">
                {ghostInfo.typeLabel}
              </span>
            </div>
          </div>
        </>,
        document.body,
      )}
    </>
  );
}
