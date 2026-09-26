export const FLUID_MOTION_DURATION_MS = 220;
export const FLUID_MOTION_EASING = "cubic-bezier(0.22, 1, 0.36, 1)";

export function getPrefersReducedMotion(): boolean {
  if (typeof window === "undefined" || !window.matchMedia) {
    return false;
  }
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

export function skipAutomaticWorkbenchMotion(): boolean {
  if (getPrefersReducedMotion()) return true;
  if (typeof document === "undefined") return false;
  return (
    document
      .querySelector?.("[data-slot='sidebar-wrapper']")
      ?.getAttribute("data-panel-animations") === "false"
  );
}
