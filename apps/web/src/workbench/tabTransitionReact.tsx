import { useEffect, useLayoutEffect, useRef, useSyncExternalStore } from "react";

import {
  animateTabTransitionTo,
  beginTabTransition,
  deriveTabDirection,
  endTabTransition,
  getTabTransition,
  subscribeTabTransition,
  tabIdsKey,
  type TabTransitionState,
} from "./tabTransition";
import { getPrefersReducedMotion } from "./workbenchMotion";
import { useWorkbenchStore } from "./workbenchStore";

/** Subscribe to the low-frequency shape of the in-flight Sliding Tab switch. */
export function useTabTransition(): TabTransitionState | null {
  return useSyncExternalStore(subscribeTabTransition, getTabTransition, getTabTransition);
}

/**
 * Watches `activeTabId` and drives the Sliding Tab switch for every user-navigated
 * Tab change. Structural changes (creating or closing a Tab) and reduced motion land
 * instantly, per ADR-0019.
 */
export function TabTransitionController() {
  const activeTabId = useWorkbenchStore((state) => state.activeTabId);
  const tabIds = useWorkbenchStore((state) => tabIdsKey(state.tabs));
  const previousRef = useRef({ activeTabId, tabIds });
  const settleCancelRef = useRef<(() => void) | null>(null);

  useLayoutEffect(() => {
    const previous = previousRef.current;
    previousRef.current = { activeTabId, tabIds };
    if (previous.activeTabId === activeTabId) return;

    const inFlight = getTabTransition();
    // A right-drag or wheel commit already owns this transition.
    if (inFlight !== null && inFlight.toTabId === activeTabId) return;

    settleCancelRef.current?.();
    settleCancelRef.current = null;

    const tabs = useWorkbenchStore.getState().tabs;
    const structural = previous.tabIds !== tabIds;
    if (structural || tabs.length <= 1 || getPrefersReducedMotion()) {
      endTabTransition();
      return;
    }

    const fromIndex = tabs.findIndex((tab) => tab.id === previous.activeTabId);
    const toIndex = tabs.findIndex((tab) => tab.id === activeTabId);
    const dir = deriveTabDirection(fromIndex, toIndex);
    if (fromIndex < 0 || toIndex < 0 || dir === 0) {
      endTabTransition();
      return;
    }

    beginTabTransition({
      fromTabId: previous.activeTabId,
      toTabId: activeTabId,
      fromIndex,
      toIndex,
      dir,
    });
    settleCancelRef.current = animateTabTransitionTo(1);
  }, [activeTabId, tabIds]);

  useEffect(
    () => () => {
      settleCancelRef.current?.();
    },
    [],
  );

  return null;
}
