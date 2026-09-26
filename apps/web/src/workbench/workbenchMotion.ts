import { getClientSettings } from "../hooks/useSettings";

export const FLUID_MOTION_DURATION_MS = 220;
export const FLUID_MOTION_EASING = "cubic-bezier(0.22, 1, 0.36, 1)";

export function getAnimationDurationScale(): number {
  return getClientSettings().animationDurationScale;
}

export function scaledMotionDuration(baseMs: number): number {
  return getPrefersReducedMotion() ? 0 : baseMs * getAnimationDurationScale();
}

export function getPrefersReducedMotion(): boolean {
  if (typeof window === "undefined" || !window.matchMedia) {
    return false;
  }
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

export function skipAutomaticWorkbenchMotion(): boolean {
  return getPrefersReducedMotion() || getAnimationDurationScale() === 0;
}
