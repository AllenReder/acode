import { useEffect, useRef } from "react";

import { dismissContextMenu } from "../contextMenuFallback";
import type { MenuAnchorPosition } from "./paneMenuRegistry";
import { resolveLayoutPan } from "./tabSwitchGesture";
import {
  beginTabTransition,
  clampProgress,
  endTabTransition,
  getTabTransition,
  getTabTransitionFrame,
  nextTabIndex,
  resolveSwitchCommit,
  setTabTransitionProgress,
} from "./tabTransition";
import { finishTabSwitch } from "./tabTransitionReact";
import { useWorkbenchStore } from "./workbenchStore";

const RIGHT_DRAG_THRESHOLD = 5;
const VELOCITY_WINDOW_MS = 90;

export interface TabSwitchGestureOptions {
  readonly stageRef: React.RefObject<HTMLElement | null>;
  readonly onPaneContextMenu: (paneId: string, position: MenuAnchorPosition) => void;
}

interface RightDragSession {
  readonly pointerId: number;
  readonly startX: number;
  readonly paneId: string | null;
  readonly viewport: HTMLElement | null;
  readonly layoutMode: string | null;
  readonly startScrollLeft: number;
  readonly maxScrollLeft: number;
  readonly viewportWidth: number;
  readonly samples: Array<{ readonly x: number; readonly t: number }>;
  active: boolean;
}

function estimateVelocity(session: RightDragSession, releasedAt: number): number {
  if (session.samples.length < 2) return 0;
  const last = session.samples.at(-1)!;
  if (releasedAt - last.t >= VELOCITY_WINDOW_MS) return 0;
  const cutoff = releasedAt - VELOCITY_WINDOW_MS;
  const first = session.samples.find((sample) => sample.t >= cutoff) ?? session.samples[0]!;
  const dt = releasedAt - first.t;
  if (dt <= 0) return 0;
  return (last.x - first.x) / dt;
}

/**
 * Right-button Layout pan and Sliding Tab switch (ADR-0019). Horizontal-only:
 * Phase 1 pans a Scrolling layout 1:1, and the travel it cannot consume becomes
 * Tab switch progress, which resolves to a commit or a cancel on release. A
 * right press that never crosses the threshold opens the Pane header menu.
 */
export function useTabSwitchGesture(options: TabSwitchGestureOptions): void {
  const { stageRef, onPaneContextMenu } = options;
  const onPaneContextMenuRef = useRef(onPaneContextMenu);
  useEffect(() => {
    onPaneContextMenuRef.current = onPaneContextMenu;
  }, [onPaneContextMenu]);

  useEffect(() => {
    const stage = stageRef.current;
    if (stage === null || typeof window === "undefined" || typeof document === "undefined") return;

    let session: RightDragSession | null = null;

    const updateDrag = (current: RightDragSession, dx: number) => {
      const store = useWorkbenchStore.getState();
      const tabs = store.tabs;

      let overscroll = Math.abs(dx);
      if (
        current.layoutMode === "scrolling" &&
        current.viewport !== null &&
        current.maxScrollLeft > 0
      ) {
        const pan = resolveLayoutPan({
          startScrollLeft: current.startScrollLeft,
          dragX: dx,
          maxScrollLeft: current.maxScrollLeft,
        });
        current.viewport.scrollLeft = pan.scrollLeft;
        overscroll = pan.overscroll;
      }

      if (overscroll <= 0 || tabs.length <= 1) {
        if (getTabTransition() !== null) endTabTransition();
        return;
      }

      const dir: -1 | 1 = dx < 0 ? 1 : -1;
      const inFlight = getTabTransition();
      if (inFlight === null || inFlight.dir !== dir || inFlight.fromTabId !== store.activeTabId) {
        const fromIndex = tabs.findIndex((tab) => tab.id === store.activeTabId);
        const toIndex = nextTabIndex(tabs.length, fromIndex, dir);
        const target = tabs[toIndex];
        if (target === undefined || toIndex === fromIndex) {
          endTabTransition();
          return;
        }
        beginTabTransition({
          fromTabId: store.activeTabId,
          toTabId: target.id,
          fromIndex,
          toIndex,
          dir,
        });
      }
      setTabTransitionProgress(clampProgress(overscroll / Math.max(1, current.viewportWidth)));
    };

    const finishDrag = () => {
      window.removeEventListener("pointermove", onPointerMove, true);
      window.removeEventListener("pointerup", onPointerUp, true);
      window.removeEventListener("pointercancel", onCancel, true);
      window.removeEventListener("blur", onCancel);
      window.removeEventListener("keydown", onKeyDown, true);
      session = null;
    };

    const onPointerMove = (event: PointerEvent) => {
      const current = session;
      if (current === null || event.pointerId !== current.pointerId) return;
      current.samples.push({ x: event.clientX, t: performance.now() });
      while (current.samples.length > 10) current.samples.shift();
      const dx = event.clientX - current.startX;
      if (!current.active) {
        if (Math.abs(dx) < RIGHT_DRAG_THRESHOLD) return;
        current.active = true;
        dismissContextMenu();
      }
      updateDrag(current, dx);
    };

    const onPointerUp = (event: PointerEvent) => {
      const current = session;
      if (current === null || event.pointerId !== current.pointerId) return;
      const wasActive = current.active;
      const paneId = current.paneId;
      finishDrag();
      if (!wasActive) {
        if (paneId !== null) {
          onPaneContextMenuRef.current(paneId, { x: event.clientX, y: event.clientY });
        }
        return;
      }
      const inFlight = getTabTransition();
      if (inFlight === null) return;
      const commit = resolveSwitchCommit({
        progress: getTabTransitionFrame()?.progress ?? 0,
        velocity: estimateVelocity(current, performance.now()),
        dir: inFlight.dir,
      });
      finishTabSwitch(commit);
    };

    const onCancel = () => {
      if (session === null) return;
      const active = session.active;
      finishDrag();
      if (active) finishTabSwitch(false);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onCancel();
    };

    const onPointerDown = (event: PointerEvent) => {
      if (event.button !== 2) return;
      const target = event.target instanceof Element ? event.target : null;
      if (target === null || !stage.contains(target)) return;
      const viewport = stage.querySelector<HTMLElement>(
        ".workbench-viewport[data-tab-active='true']",
      );
      const header = target.closest<HTMLElement>("[data-workbench-pane-drag-handle]");
      if (session !== null) onCancel();
      endTabTransition();
      session = {
        pointerId: event.pointerId,
        startX: event.clientX,
        paneId: header?.closest<HTMLElement>("[data-pane-id]")?.dataset.paneId ?? null,
        viewport,
        layoutMode: viewport?.dataset.layoutMode ?? null,
        startScrollLeft: viewport?.scrollLeft ?? 0,
        maxScrollLeft:
          viewport === null ? 0 : Math.max(0, viewport.scrollWidth - viewport.clientWidth),
        viewportWidth: viewport?.clientWidth ?? stage.clientWidth,
        samples: [{ x: event.clientX, t: performance.now() }],
        active: false,
      };
      window.addEventListener("pointermove", onPointerMove, true);
      window.addEventListener("pointerup", onPointerUp, true);
      window.addEventListener("pointercancel", onCancel, true);
      window.addEventListener("blur", onCancel);
      window.addEventListener("keydown", onKeyDown, true);
    };

    const onContextMenu = (event: MouseEvent) => {
      event.preventDefault();
    };

    stage.addEventListener("pointerdown", onPointerDown, true);
    stage.addEventListener("contextmenu", onContextMenu, true);

    return () => {
      stage.removeEventListener("pointerdown", onPointerDown, true);
      stage.removeEventListener("contextmenu", onContextMenu, true);
      if (session !== null) {
        finishDrag();
        endTabTransition();
      }
    };
  }, [stageRef]);
}
