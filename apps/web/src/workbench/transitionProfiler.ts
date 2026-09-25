import { subscribeTabTransition, type TabTransitionState } from "./tabTransition";
import { useWorkbenchStore } from "./workbenchStore";

/**
 * Opt-in diagnostic for Sliding Tab switch stalls. Enable it by loading the app
 * with `?profileTabSwitch` in the URL or `localStorage["awen:profile-tab-switch"] = "1"`,
 * reproduce a switch, then read `window.__awenTabSwitchReports` (also logged to the
 * console and marked on the DevTools Performance timeline).
 *
 * It answers the first question a stall raises: was it a JavaScript long task (React
 * render, ResizeObserver callback) or a browser layout/paint gap? A long task appears
 * in `longTasks`; a frame gap with no matching long task is layout/paint/compositing.
 */
export interface TabSwitchLongTask {
  readonly offsetMs: number;
  readonly durationMs: number;
  readonly name: string;
  readonly attribution: string;
}

export interface TabSwitchReport {
  readonly fromTabId: string;
  readonly toTabId: string;
  readonly durationMs: number;
  readonly frames: number;
  readonly worstFrameMs: number;
  readonly worstFrameOffsetMs: number;
  readonly droppedFrameCount: number;
  /** When `activeTabId` changed, relative to the transition start. */
  readonly activeTabChangedOffsetMs: number | null;
  readonly longTasks: ReadonlyArray<TabSwitchLongTask>;
}

declare global {
  interface Window {
    __awenTabSwitchReports?: TabSwitchReport[];
  }
}

const FRAME_BUDGET_MS = 1000 / 60;
const DROPPED_FRAME_FACTOR = 1.5;

let installed = false;
let observing = false;
let transition: TabTransitionState | null = null;
let startTime = 0;
let lastFrameTime = 0;
let frames = 0;
let worstFrameMs = 0;
let worstFrameOffsetMs = 0;
let droppedFrameCount = 0;
let longTasks: TabSwitchLongTask[] = [];
let activeTabChangedOffsetMs: number | null = null;
let frameHandle: number | null = null;
let longTaskObserver: PerformanceObserver | null = null;
let unsubscribeStore: (() => void) | null = null;

function reports(): TabSwitchReport[] {
  window.__awenTabSwitchReports ??= [];
  return window.__awenTabSwitchReports;
}

function attributionFor(entry: PerformanceEntry): string {
  const attribution = (entry as PerformanceEntry & { attribution?: Array<{ name?: string }> })
    .attribution;
  const names = (attribution ?? []).map((item) => item.name ?? "unknown");
  return names.length > 0 ? names.join(",") : "unknown";
}

function frame(now: number): void {
  if (!observing) return;
  if (lastFrameTime !== 0) {
    const gap = now - lastFrameTime;
    frames += 1;
    if (gap > worstFrameMs) {
      worstFrameMs = gap;
      worstFrameOffsetMs = now - startTime;
    }
    if (gap > FRAME_BUDGET_MS * DROPPED_FRAME_FACTOR) droppedFrameCount += 1;
  }
  lastFrameTime = now;
  frameHandle = requestAnimationFrame(frame);
}

function stopObserving(): void {
  observing = false;
  if (frameHandle !== null) {
    cancelAnimationFrame(frameHandle);
    frameHandle = null;
  }
  longTaskObserver?.disconnect();
  longTaskObserver = null;
  unsubscribeStore?.();
  unsubscribeStore = null;
}

function begin(next: TabTransitionState): void {
  stopObserving();
  observing = true;
  transition = next;
  startTime = performance.now();
  lastFrameTime = 0;
  frames = 0;
  worstFrameMs = 0;
  worstFrameOffsetMs = 0;
  droppedFrameCount = 0;
  longTasks = [];
  activeTabChangedOffsetMs = null;
  performance.mark("tab-switch:start");

  let activeTabId = useWorkbenchStore.getState().activeTabId;
  unsubscribeStore = useWorkbenchStore.subscribe((state) => {
    if (state.activeTabId === activeTabId) return;
    activeTabId = state.activeTabId;
    activeTabChangedOffsetMs ??= Math.round(performance.now() - startTime);
  });

  try {
    longTaskObserver = new PerformanceObserver((list) => {
      for (const entry of list.getEntries()) {
        longTasks.push({
          offsetMs: Math.round(entry.startTime - startTime),
          durationMs: Math.round(entry.duration),
          name: entry.name,
          attribution: attributionFor(entry),
        });
      }
    });
    longTaskObserver.observe({ entryTypes: ["longtask"] });
  } catch {
    longTaskObserver = null;
  }

  frameHandle = requestAnimationFrame(frame);
}

function end(): void {
  if (!observing || transition === null) return;
  performance.mark("tab-switch:end");
  performance.measure("tab-switch", "tab-switch:start", "tab-switch:end");
  const report: TabSwitchReport = {
    fromTabId: transition.fromTabId,
    toTabId: transition.toTabId,
    durationMs: Math.round(performance.now() - startTime),
    frames,
    worstFrameMs: Math.round(worstFrameMs),
    worstFrameOffsetMs: Math.round(worstFrameOffsetMs),
    droppedFrameCount,
    activeTabChangedOffsetMs,
    longTasks,
  };
  transition = null;
  stopObserving();
  reports().push(report);
  console.info("[tab-switch]", report);
  if (report.longTasks.length > 0) console.table(report.longTasks);
}

function enabledByFlag(): boolean {
  if (typeof window === "undefined") return false;
  if (new URLSearchParams(window.location.search).has("profileTabSwitch")) return true;
  try {
    return window.localStorage.getItem("awen:profile-tab-switch") === "1";
  } catch {
    return false;
  }
}

/** Idempotent. No-op unless the opt-in flag is set. */
export function installTabSwitchProfiler(): void {
  if (installed || typeof window === "undefined" || typeof performance === "undefined") return;
  installed = true;
  if (!enabledByFlag()) return;
  subscribeTabTransition((state) => {
    if (state !== null) begin(state);
    else end();
  });
  window.__awenTabSwitchReports ??= [];
  console.info(
    "[tab-switch] profiler enabled. Reports land in window.__awenTabSwitchReports and the console.",
  );
}
