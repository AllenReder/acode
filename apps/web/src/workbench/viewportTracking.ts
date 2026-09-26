import { useLayoutEffect } from "react";

import type { ViewportMetrics } from "./viewportMetrics";

/**
 * The active Scrolling Tab's Viewport readings, published by the Viewport
 * owner and consumed by the Topbar Tab indicator (ADR-0025).
 *
 * Only the active Tab's Viewport publishes, so a reading is always the one the
 * indicator should express. The record is replaced only when a field actually
 * changes, so subscribers that bail out on identity do not re-render per frame.
 */
let published: ViewportMetrics | null = null;
const listeners = new Set<() => void>();

export function getViewportMetrics(): ViewportMetrics | null {
  return published;
}

export function subscribeViewportMetrics(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function publishViewportMetrics(next: ViewportMetrics | null): void {
  const current = published;
  if (current === next) return;
  if (
    current !== null &&
    next !== null &&
    current.tabId === next.tabId &&
    current.clientWidth === next.clientWidth &&
    current.scrollWidth === next.scrollWidth &&
    current.scrollLeft === next.scrollLeft
  ) {
    return;
  }
  published = next;
  for (const listener of listeners) listener();
}

export function resetViewportMetricsForTest(): void {
  published = null;
  listeners.clear();
}

/**
 * Publish one Tab's Viewport readings while it is the active Tab.
 *
 * The scroll offset is the only reading that changes per frame, so the scroll
 * listener reads nothing but `scrollLeft` and reuses the geometry captured at
 * publish time. Reading layout per frame here would force a synchronous reflow
 * of the pane subtree on every wheel tick.
 */
export function usePublishViewportMetrics(options: {
  readonly ref: React.RefObject<HTMLElement | null>;
  readonly tabId: string;
  readonly active: boolean;
}): void {
  const { ref, tabId, active } = options;
  // Measured in a layout effect so the readings are taken in the commit's own
  // layout pass, before paint: the indicator can then settle in the same commit
  // instead of the browser painting the un-narrowed bar first.
  useLayoutEffect(() => {
    const element = ref.current;
    if (!active || element === null || typeof element.getBoundingClientRect !== "function") return;

    const box = { clientWidth: element.clientWidth, scrollWidth: element.scrollWidth };
    const publish = (scrollLeft: number) =>
      publishViewportMetrics({
        tabId,
        clientWidth: box.clientWidth,
        scrollWidth: box.scrollWidth,
        scrollLeft,
      });

    const rebox = () => {
      box.clientWidth = element.clientWidth;
      box.scrollWidth = element.scrollWidth;
      publish(element.scrollLeft);
    };

    rebox();
    const onScroll = () => publish(element.scrollLeft);
    element.addEventListener("scroll", onScroll, { passive: true });

    // Column resizes and Pane moves change the canvas size, not the scroll
    // offset, so watch the canvas itself rather than re-running this effect.
    const observer = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(rebox);
    observer?.observe(element);
    const canvas = element.firstElementChild;
    if (canvas !== null) observer?.observe(canvas);

    return () => {
      element.removeEventListener("scroll", onScroll);
      observer?.disconnect();
      publishViewportMetrics(null);
    };
  }, [ref, tabId, active]);
}
