import { useEffect } from "react";

import {
  findHorizontalScrollerConsuming,
  resolveHorizontalWheelDelta,
  resolveWheelSwitchDirection,
} from "./tabSwitchGesture";
import { nextTabIndex, subscribeTabTransition } from "./tabTransition";
import { useWorkbenchStore } from "./workbenchStore";

const WHEEL_SWITCH_SAFETY_MS = 800;

/**
 * Wheel-driven Stacked Tab switching (ADR-0019). Each horizontal notch commits
 * one full switch and notches are queued while a switch settles. Any horizontal
 * scroller between the wheel target and the Workbench stage — including a
 * Scrolling layout with room — consumes the gesture first.
 */
export function useTabSwitchWheel(stageRef: React.RefObject<HTMLElement | null>): void {
  useEffect(() => {
    const stage = stageRef.current;
    if (stage === null || typeof window === "undefined" || typeof document === "undefined") return;

    const wheelQueue: Array<-1 | 1> = [];
    let wheelBusy = false;
    let wheelUnsubscribe: (() => void) | null = null;
    let wheelTimer: ReturnType<typeof setTimeout> | null = null;

    const releaseWheel = () => {
      wheelBusy = false;
      wheelUnsubscribe?.();
      wheelUnsubscribe = null;
      if (wheelTimer !== null) {
        clearTimeout(wheelTimer);
        wheelTimer = null;
      }
      processWheelQueue();
    };

    const processWheelQueue = () => {
      if (wheelBusy) return;
      const dir = wheelQueue.shift();
      if (dir === undefined) return;
      const store = useWorkbenchStore.getState();
      if (store.tabs.length <= 1) return;
      const fromIndex = store.tabs.findIndex((tab) => tab.id === store.activeTabId);
      const toIndex = nextTabIndex(store.tabs.length, fromIndex, dir);
      const target = store.tabs[toIndex];
      if (target === undefined || toIndex === fromIndex) return;
      wheelBusy = true;
      wheelUnsubscribe = subscribeTabTransition((state) => {
        if (state === null) releaseWheel();
      });
      wheelTimer = setTimeout(releaseWheel, WHEEL_SWITCH_SAFETY_MS);
      store.activateTab(target.id);
    };

    const onWheel = (event: WheelEvent) => {
      const delta = resolveHorizontalWheelDelta(event, stage.clientWidth);
      if (delta === 0) return;
      const target = event.target instanceof Element ? event.target : null;
      if (target !== null && findHorizontalScrollerConsuming(target, stage, delta)) return;
      event.preventDefault();
      event.stopPropagation();
      if (useWorkbenchStore.getState().tabs.length <= 1) return;
      wheelQueue.push(resolveWheelSwitchDirection(delta));
      processWheelQueue();
    };

    stage.addEventListener("wheel", onWheel, { capture: true, passive: false });

    return () => {
      stage.removeEventListener("wheel", onWheel, true);
      if (wheelTimer !== null) clearTimeout(wheelTimer);
      wheelUnsubscribe?.();
      wheelQueue.length = 0;
      wheelBusy = false;
    };
  }, [stageRef]);
}
