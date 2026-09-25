import { useEffect } from "react";

import {
  findHorizontalScroller,
  resolveHorizontalWheelDelta,
  resolveWheelSwitchDirection,
} from "./tabSwitchGesture";
import { getTabTransition, subscribeTabTransition } from "./tabTransition";
import { switchAdjacentTab } from "./tabTransitionReact";
import { useWorkbenchStore } from "./workbenchStore";

/** Maximum number of queued tab switches waiting behind the active transition. */
const MAX_WHEEL_QUEUE_DEPTH = 2;

/** One stage listener routes horizontal intent from the innermost scroller to Tabs. */
export function useTabSwitchWheel(stageRef: React.RefObject<HTMLElement | null>): void {
  useEffect(() => {
    const stage = stageRef.current;
    if (stage === null || typeof window === "undefined" || typeof document === "undefined") return;
    const queue: Array<-1 | 1> = [];
    let disposed = false;
    const processQueue = () => {
      if (disposed || getTabTransition() !== null) return;
      if (useWorkbenchStore.getState().tabs.length <= 1) {
        queue.length = 0;
        return;
      }
      const dir = queue.shift();
      if (dir !== undefined) switchAdjacentTab(dir);
    };
    const unsubscribe = subscribeTabTransition((state) => {
      // Never begin a new transition inside the old transition's completion notification.
      if (state === null) queueMicrotask(processQueue);
    });
    const onWheel = (event: WheelEvent) => {
      const delta = resolveHorizontalWheelDelta(event, stage.clientWidth);
      if (delta === 0) return;
      const target = event.target instanceof Element ? event.target : null;
      const scroller = findHorizontalScroller(target, stage, delta);
      event.preventDefault();
      event.stopPropagation();
      if (scroller !== null) {
        // Explicitly translate shift+deltaY too; native handlers differ across platforms.
        scroller.scrollLeft = Math.max(
          0,
          Math.min(scroller.scrollWidth - scroller.clientWidth, scroller.scrollLeft + delta),
        );
        return;
      }
      // A macOS trackpad emits a continuous stream of unmodified pixel deltas
      // for one two-finger gesture. Those deltas are content navigation and
      // must never queue discrete Tab switch commands. Only deliberate
      // Shift+wheel gestures promote to Tab switching once scrolling is exhausted.
      if (!event.shiftKey) return;
      if (queue.length >= MAX_WHEEL_QUEUE_DEPTH) return;
      queue.push(resolveWheelSwitchDirection(delta));
      processQueue();
    };
    stage.addEventListener("wheel", onWheel, { capture: true, passive: false });
    return () => {
      disposed = true;
      stage.removeEventListener("wheel", onWheel, true);
      unsubscribe();
      queue.length = 0;
    };
  }, [stageRef]);
}
