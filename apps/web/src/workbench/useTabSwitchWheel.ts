import { useEffect } from "react";
import { listen } from "@tauri-apps/api/event";

import {
  findHorizontalScroller,
  normalizeWheelDelta,
  resolveHorizontalWheelDelta,
  resolveWheelSwitchDirection,
} from "./tabSwitchGesture";
import {
  beginTabTransition,
  getTabTransition,
  getTabTransitionFrame,
  interruptTabSettle,
  nextTabIndex,
  retargetTabTransition,
  setTabTransitionPosition,
} from "./tabTransition";
import { switchAdjacentTab } from "./tabTransitionReact";
import { finishTabSwitch } from "./tabTransitionReact";
import { useWorkbenchStore } from "./workbenchStore";

interface NativeScrollPhase {
  readonly phase: "began" | "changed" | "ended" | "cancelled" | "none";
  readonly momentumPhase: "began" | "changed" | "ended" | "cancelled" | "none";
}

interface TrackpadSession {
  phase: "direct" | "momentum";
  lastTime: number;
  velocity: number;
  switched: boolean;
  scrolled: boolean;
}

const TRACKPAD_SWITCH_TRAVEL = 360;

/** One stage listener routes horizontal intent from the innermost scroller to Tabs. */
export function useTabSwitchWheel(stageRef: React.RefObject<HTMLElement | null>): void {
  useEffect(() => {
    const stage = stageRef.current;
    if (stage === null || typeof window === "undefined" || typeof document === "undefined") return;
    let session: TrackpadSession | null = null;
    let disposed = false;
    let unlisten: (() => void) | null = null;
    const finishDirect = (cancelled = false) => {
      if (session?.phase !== "direct") return;
      const frame = getTabTransitionFrame();
      if (session.switched && frame !== null) {
        const velocity = performance.now() - session.lastTime > 90 ? 0 : session.velocity;
        const releaseVelocity = (velocity * 1000) / TRACKPAD_SWITCH_TRAVEL;
        setTabTransitionPosition(frame.position, Math.max(-2, Math.min(2, releaseVelocity)));
        finishTabSwitch(!cancelled && frame.progress >= 0.5);
        session.phase = "momentum";
      } else if (session.scrolled) {
        session.phase = "momentum";
      } else {
        session = null;
      }
    };
    if (window.desktopBridge !== undefined && /Mac/i.test(navigator.platform)) {
      void listen<NativeScrollPhase>("awen:scroll-phase", ({ payload }) => {
        if (payload.phase === "began") {
          session = {
            phase: "direct",
            lastTime: performance.now(),
            velocity: 0,
            switched: false,
            scrolled: false,
          };
        } else if (payload.phase === "changed" && session === null) {
          session = {
            phase: "direct",
            lastTime: performance.now(),
            velocity: 0,
            switched: false,
            scrolled: false,
          };
        } else if (payload.momentumPhase === "ended" || payload.momentumPhase === "cancelled") {
          finishDirect();
          session = null;
        } else if (
          payload.phase === "ended" ||
          payload.phase === "cancelled" ||
          payload.momentumPhase !== "none"
        ) {
          finishDirect(payload.phase === "cancelled");
        }
      })
        .then((dispose) => {
          if (disposed) dispose();
          else unlisten = dispose;
        })
        .catch((error: unknown) => {
          console.error("Could not observe native scroll phases.", error);
        });
    }

    const consumeScroll = (target: Element | null, delta: number): number => {
      let remaining = delta;
      let current = target;
      while (current !== null && Math.abs(remaining) > 0.001) {
        const scroller = findHorizontalScroller(current, stage, remaining);
        if (scroller === null) break;
        const before = scroller.scrollLeft;
        scroller.scrollLeft = Math.max(
          0,
          Math.min(scroller.scrollWidth - scroller.clientWidth, before + remaining),
        );
        remaining -= scroller.scrollLeft - before;
        current = scroller.parentElement;
      }
      return remaining;
    };

    const moveTrackpadTab = (delta: number): number => {
      const state = useWorkbenchStore.getState();
      if (state.tabs.length <= 1) return delta;
      const dir: -1 | 1 = delta > 0 ? 1 : -1;
      const fromIndex = state.tabs.findIndex((tab) => tab.id === state.activeTabId);
      const toIndex = nextTabIndex(state.tabs.length, fromIndex, dir);
      const toTab = state.tabs[toIndex];
      if (!toTab) return delta;
      const next = { fromTabId: state.activeTabId, toTabId: toTab.id, fromIndex, toIndex, dir };
      if (!session?.switched) interruptTabSettle();
      const existing = getTabTransition();
      if (existing === null) beginTabTransition(next);
      else if (!session?.switched && existing.toTabId !== toTab.id) retargetTabTransition(next);
      const frame = getTabTransitionFrame();
      if (!frame) return delta;
      const from = frame.cards.find((card) => card.tabId === frame.fromTabId)?.slot ?? 0;
      const to = frame.destinationSlot;
      const proposed = frame.position + delta / TRACKPAD_SWITCH_TRAVEL;
      const position = Math.max(Math.min(from, to), Math.min(Math.max(from, to), proposed));
      setTabTransitionPosition(position);
      session!.switched = true;
      return (proposed - position) * TRACKPAD_SWITCH_TRAVEL;
    };
    const onWheel = (event: WheelEvent) => {
      if (session?.phase === "momentum" && !event.shiftKey) {
        if (session.switched) {
          event.preventDefault();
          event.stopPropagation();
        }
        return;
      }
      if (session?.phase === "direct" && !event.shiftKey) {
        const delta = normalizeWheelDelta(event.deltaX, event.deltaMode, stage.clientWidth);
        if (Math.abs(delta) <= Math.abs(event.deltaY) || delta === 0) return;
        const target = event.target instanceof Element ? event.target : null;
        if (
          !session.switched &&
          (session.scrolled || findHorizontalScroller(target, stage, delta) !== null)
        ) {
          session.scrolled = true;
          // Keep WebKit's direct-scroll and momentum pipeline intact.
          return;
        }
        event.preventDefault();
        event.stopPropagation();
        const time = performance.now();
        const dt = time - session.lastTime;
        session.velocity = dt > 0 ? delta / dt : 0;
        session.lastTime = time;
        let remaining = delta;
        if (session.switched) {
          const frame = getTabTransitionFrame();
          if (frame !== null) {
            const from = frame.cards.find((card) => card.tabId === frame.fromTabId)?.slot ?? 0;
            const towardSource = Math.sign(remaining) !== frame.dir;
            remaining = moveTrackpadTab(remaining);
            const after = getTabTransitionFrame();
            if (towardSource && after !== null && after.position === from) {
              finishTabSwitch(false);
              session.switched = false;
              session.scrolled = true;
              if (remaining !== 0) {
                consumeScroll(target, remaining);
              }
            }
            return;
          }
          session.switched = false;
        }
        if (session.scrolled) {
          consumeScroll(target, remaining);
          return;
        }
        remaining = consumeScroll(target, remaining);
        if (remaining !== delta) session.scrolled = true;
        if (remaining !== 0 && !session.scrolled) moveTrackpadTab(remaining);
        return;
      }
      const delta = resolveHorizontalWheelDelta(event, stage.clientWidth);
      if (delta === 0) return;
      const target = event.target instanceof Element ? event.target : null;
      const scroller = findHorizontalScroller(target, stage, delta);
      if (scroller !== null && !event.shiftKey) return;
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
      switchAdjacentTab(resolveWheelSwitchDirection(delta));
    };
    stage.addEventListener("wheel", onWheel, { capture: true, passive: false });
    return () => {
      disposed = true;
      unlisten?.();
      stage.removeEventListener("wheel", onWheel, true);
    };
  }, [stageRef]);
}
