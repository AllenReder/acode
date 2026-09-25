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

function measureTabGeometry(strip: HTMLElement, tabId: string): TabIndicatorGeometry | null {
  const element = strip.querySelector<HTMLElement>(`[data-tab-id="${escapeSelector(tabId)}"]`);
  if (element === null) return null;
  const stripRect = strip.getBoundingClientRect();
  const rect = element.getBoundingClientRect();
  return { left: rect.left - stripRect.left + strip.scrollLeft, width: rect.width };
}

function writeIndicatorGeometry(style: CSSStyleDeclaration, geometry: TabIndicatorGeometry): void {
  style.transform = `translateX(${geometry.left}px)`;
  style.width = `${geometry.width}px`;
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
 */
export function useTabIndicator(
  options: TabIndicatorOptions,
): React.RefObject<HTMLSpanElement | null> {
  const { stripRef, activeTabId, revision, dragging } = options;
  const indicatorRef = useRef<HTMLSpanElement | null>(null);
  const lastGeometryRef = useRef<TabIndicatorGeometry | null>(null);
  const transition = useTabTransition();

  useLayoutEffect(() => {
    const strip = stripRef.current;
    const indicator = indicatorRef.current;
    const indicatorStyle = (indicator as { style?: CSSStyleDeclaration } | null)?.style;
    if (strip === null || indicator === null || !indicatorStyle) return;
    if (typeof strip.getBoundingClientRect !== "function") return;
    if (revision === "") return;

    const write = (geometry: TabIndicatorGeometry) => {
      writeIndicatorGeometry(indicatorStyle, geometry);
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

    if (transition === null) {
      const geometry = measureTabGeometry(strip, activeTabId);
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
    const applyFrame = () => {
      const frame = getTabTransitionFrame();
      if (frame === null) return;
      const from = measureTabGeometry(strip, frame.fromTabId);
      const to = measureTabGeometry(strip, frame.toTabId);
      if (from === null || to === null) return;
      write(interpolateIndicatorGeometry(from, to, frame.progress));
    };
    applyFrame();
    return subscribeTabTransitionFrame(applyFrame);
  }, [stripRef, activeTabId, revision, dragging, transition]);

  useEffect(() => {
    const strip = stripRef.current;
    if (strip === null || typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(() => {
      if (getTabTransition() !== null) return;
      const indicator = indicatorRef.current;
      const indicatorStyle = (indicator as { style?: CSSStyleDeclaration } | null)?.style;
      if (indicator === null || !indicatorStyle) return;
      const geometry = measureTabGeometry(strip, activeTabId);
      if (geometry === null) return;
      writeIndicatorGeometry(indicatorStyle, geometry);
      lastGeometryRef.current = geometry;
    });
    observer.observe(strip);
    return () => observer.disconnect();
  }, [stripRef, activeTabId]);

  return indicatorRef;
}
