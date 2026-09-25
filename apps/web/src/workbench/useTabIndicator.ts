import { useEffect, useLayoutEffect, useRef } from "react";

import {
  FLUID_MOTION_DURATION_MS,
  FLUID_MOTION_EASING,
  getPrefersReducedMotion,
} from "./workbenchMotion";
import {
  getTabTransition,
  getTabTransitionFrame,
  interpolateIndicatorGeometry,
  subscribeTabTransitionFrame,
  type TabIndicatorGeometry,
} from "./tabTransition";
import { useTabTransition } from "./tabTransitionReact";

function escapeSelector(value: string): string {
  if (typeof CSS !== "undefined" && typeof CSS.escape === "function") return CSS.escape(value);
  return value.replace(/["\\]/g, "\\$&");
}

function geometryFromElement(
  stripRect: DOMRect,
  scrollLeft: number,
  element: HTMLElement,
): TabIndicatorGeometry {
  const rect = element.getBoundingClientRect();
  return { left: rect.left - stripRect.left + scrollLeft, width: rect.width };
}

function measureAllTabs(strip: HTMLElement): Map<string, TabIndicatorGeometry> {
  const map = new Map<string, TabIndicatorGeometry>();
  const stripRect = strip.getBoundingClientRect();
  const scrollLeft = strip.scrollLeft;
  for (const element of strip.querySelectorAll<HTMLElement>("[data-tab-id]")) {
    const id = element.dataset.tabId;
    if (id !== undefined) map.set(id, geometryFromElement(stripRect, scrollLeft, element));
  }
  return map;
}

function measureTabGeometry(strip: HTMLElement, tabId: string): TabIndicatorGeometry | null {
  const element = strip.querySelector<HTMLElement>(`[data-tab-id="${escapeSelector(tabId)}"]`);
  if (element === null) return null;
  return geometryFromElement(strip.getBoundingClientRect(), strip.scrollLeft, element);
}

function writeTransform(style: CSSStyleDeclaration, left: number): void {
  style.transform = `translateX(${left}px)`;
}

function writeWidth(style: CSSStyleDeclaration, width: number): void {
  style.width = `${width}px`;
}

export interface TabIndicatorOptions {
  readonly stripRef: React.RefObject<HTMLElement | null>;
  readonly activeTabId: string;
  /**
   * Changes whenever the underbar's resting geometry must be re-measured: Tab
   * reorder, create, close, or a live reorder drag frame.
   */
  readonly revision: string;
  /** True while the user is actively dragging a Tab, so the underbar follows 1:1. */
  readonly dragging: boolean;
}

/**
 * Positions the shared Topbar Tab underbar (ADR-0019). It follows Tab switch
 * progress directly and animates with Apple fluid easing on ordinary changes.
 *
 * Reading layout (`getBoundingClientRect`) is what stalls a switch: the cards have
 * just been repositioned, so any read forces a synchronous reflow of the whole
 * (possibly heavy) card subtree. Tab geometry is therefore cached at rest and
 * reused for the whole switch, and only `transform` is written per frame.
 */
export function useTabIndicator(
  options: TabIndicatorOptions,
): React.RefObject<HTMLSpanElement | null> {
  const { stripRef, activeTabId, revision, dragging } = options;
  const indicatorRef = useRef<HTMLSpanElement | null>(null);
  const lastGeometryRef = useRef<TabIndicatorGeometry | null>(null);
  const cacheRef = useRef<{ key: string | null; map: Map<string, TabIndicatorGeometry> }>({
    key: null,
    map: new Map(),
  });
  const transition = useTabTransition();

  useLayoutEffect(() => {
    const strip = stripRef.current;
    const indicator = indicatorRef.current;
    const indicatorStyle = (indicator as { style?: CSSStyleDeclaration } | null)?.style;
    if (strip === null || indicator === null || !indicatorStyle) return;
    if (typeof strip.getBoundingClientRect !== "function") return;
    if (revision === "") return;

    const write = (geometry: TabIndicatorGeometry) => {
      writeTransform(indicatorStyle, geometry.left);
      writeWidth(indicatorStyle, geometry.width);
      lastGeometryRef.current = geometry;
    };

    const animateTo = (geometry: TabIndicatorGeometry) => {
      const previous = lastGeometryRef.current;
      write(geometry);
      if (
        dragging ||
        getPrefersReducedMotion() ||
        previous === null ||
        typeof indicator.animate !== "function" ||
        typeof indicator.getAnimations !== "function"
      ) {
        return;
      }
      indicator.getAnimations().forEach((animation) => animation.cancel());
      indicator.animate(
        [
          { transform: `translateX(${previous.left}px)`, width: `${previous.width}px` },
          { transform: `translateX(${geometry.left}px)`, width: `${geometry.width}px` },
        ],
        { duration: FLUID_MOTION_DURATION_MS, easing: FLUID_MOTION_EASING },
      );
    };

    // Re-measure the strip only when its own layout changed, never per switch.
    if (!dragging && cacheRef.current.key !== revision) {
      cacheRef.current = { key: revision, map: measureAllTabs(strip) };
    }
    const geometryFor = (tabId: string): TabIndicatorGeometry | null => {
      if (dragging) return measureTabGeometry(strip, tabId);
      const cached = cacheRef.current.map.get(tabId);
      if (cached !== undefined) return cached;
      const geometry = measureTabGeometry(strip, tabId);
      if (geometry !== null) cacheRef.current.map.set(tabId, geometry);
      return geometry;
    };

    if (transition === null) {
      const geometry = geometryFor(activeTabId);
      if (geometry !== null) {
        if (dragging) write(geometry);
        else animateTo(geometry);
      }
      return;
    }

    // Gesture progress drives the underbar directly; drop any in-flight ease.
    if (typeof indicator.getAnimations === "function") {
      indicator.getAnimations().forEach((animation) => animation.cancel());
    }
    const from = geometryFor(transition.fromTabId);
    const to = geometryFor(transition.toTabId);
    if (from === null || to === null) return;
    // Width is written once; only the transform changes per frame.
    writeWidth(indicatorStyle, from.width);
    const applyFrame = () => {
      const frame = getTabTransitionFrame();
      if (frame === null) return;
      writeTransform(indicatorStyle, interpolateIndicatorGeometry(from, to, frame.progress).left);
    };
    applyFrame();
    return subscribeTabTransitionFrame(applyFrame);
  }, [stripRef, activeTabId, revision, dragging, transition]);

  useEffect(() => {
    const strip = stripRef.current;
    if (strip === null || typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(() => {
      cacheRef.current = { key: null, map: new Map() };
      if (getTabTransition() !== null) return;
      const indicator = indicatorRef.current;
      const indicatorStyle = (indicator as { style?: CSSStyleDeclaration } | null)?.style;
      if (indicator === null || !indicatorStyle) return;
      const geometry = measureTabGeometry(strip, activeTabId);
      if (geometry === null) return;
      writeTransform(indicatorStyle, geometry.left);
      writeWidth(indicatorStyle, geometry.width);
      lastGeometryRef.current = geometry;
    });
    observer.observe(strip);
    return () => observer.disconnect();
  }, [stripRef, activeTabId]);

  return indicatorRef;
}
