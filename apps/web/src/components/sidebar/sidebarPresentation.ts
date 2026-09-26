import { createMotionValue } from "../../workbench/motionValue";
import {
  COLLAPSED_TABS_INSET_MAC,
  COLLAPSED_TABS_INSET_WIN,
  DOCK_LEFT_MAC,
  DOCK_LEFT_WIN,
  EXPANDED_ACTION_RIGHT_OFFSET,
  EXPANDED_TABS_INSET,
} from "./sidebarGeometry";

export interface SidebarPresentationInput {
  readonly open: boolean;
  readonly enabled: boolean;
  readonly width: number;
  readonly durationMs: number;
}

/** Keeps the Sidebar, its gap, and titlebar controls on one presentation value. */
export function createSidebarPresentation(
  wrapper: HTMLElement,
  isMac: boolean,
  initiallyOpen: boolean,
) {
  const spring = createMotionValue(initiallyOpen ? 1 : 0);
  const collapsedInset = isMac ? COLLAPSED_TABS_INSET_MAC : COLLAPSED_TABS_INSET_WIN;
  const dockLeft = isMac ? DOCK_LEFT_MAC : DOCK_LEFT_WIN;
  let width = 0;
  const write = (fraction: number) => {
    if (Math.abs(fraction - spring.target) > 0.001) {
      document.documentElement.dataset.sidebarMotion = "true";
    } else {
      delete document.documentElement.dataset.sidebarMotion;
    }
    wrapper.style.setProperty("--sidebar-exposed-width", `${width * fraction}px`);
    wrapper.style.setProperty("--sidebar-motion-progress", `${fraction}`);
    wrapper.style.setProperty(
      "--sidebar-motion-tabs-inset",
      `${collapsedInset + (EXPANDED_TABS_INSET - collapsedInset) * fraction}px`,
    );
    wrapper.style.setProperty(
      "--sidebar-motion-action-left",
      `${dockLeft + (width - EXPANDED_ACTION_RIGHT_OFFSET - dockLeft) * fraction}px`,
    );
  };
  const unsubscribe = spring.subscribe(write);
  return {
    update(input: SidebarPresentationInput) {
      width = input.width;
      // A critically damped spring reaches about 98% at 5.83 / frequency.
      spring.setFrequency(5830 / Math.max(25, input.durationMs));
      if (input.enabled) spring.setTarget(input.open ? 1 : 0);
      else spring.setDirect(input.open ? 1 : 0);
      write(spring.value);
    },
    dispose() {
      unsubscribe();
      spring.stop();
      delete document.documentElement.dataset.sidebarMotion;
    },
  };
}
