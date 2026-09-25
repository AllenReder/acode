import { settleEaseOut } from "./scrollingAnimation";
import { getPrefersReducedMotion } from "./workbenchMotion";

/** Time the strip takes to settle from its release position to 0 or 1. */
export const TAB_SETTLE_DURATION_MS = 340;
/** Pointer progress required to commit a Sliding Tab switch on release. */
export const TAB_SWITCH_COMMIT_PROGRESS = 0.5;
/** Release velocity (px/ms) that commits a Sliding Tab switch regardless of progress. */
export const TAB_SWITCH_FLICK_VELOCITY = 0.35;

export interface TabTransitionState {
  readonly fromTabId: string;
  readonly toTabId: string;
  readonly fromIndex: number;
  readonly toIndex: number;
  /** +1 when the target Tab sits to the right of the source Tab, -1 otherwise. */
  readonly dir: -1 | 1;
}

export interface TabTransitionFrame extends TabTransitionState {
  readonly progress: number;
}

export function clampProgress(value: number): number {
  if (!Number.isFinite(value)) return 0;
  if (value <= 0) return 0;
  if (value >= 1) return 1;
  return value;
}

/**
 * Horizontal offset of a card, in viewport widths. `slot` is the card's resting
 * slot relative to the incoming card (0 for the target, -dir for the source);
 * the strip translates by `dir` until the target reaches the viewport.
 */
export function computeCardOffset(slot: number, dir: -1 | 1, progress: number): number {
  return slot + dir * (1 - clampProgress(progress));
}

export function deriveTabDirection(fromIndex: number, toIndex: number): -1 | 1 | 0 {
  if (fromIndex === toIndex) return 0;
  return toIndex > fromIndex ? 1 : -1;
}

export function nextTabIndex(count: number, currentIndex: number, dir: -1 | 1): number {
  if (count <= 0) return -1;
  return (currentIndex + dir + count) % count;
}

export interface TabIndicatorGeometry {
  readonly left: number;
  readonly width: number;
}

export function interpolateIndicatorGeometry(
  from: TabIndicatorGeometry,
  to: TabIndicatorGeometry,
  progress: number,
): TabIndicatorGeometry {
  const p = clampProgress(progress);
  return {
    left: from.left + (to.left - from.left) * p,
    width: from.width + (to.width - from.width) * p,
  };
}

export interface SwitchCommitInput {
  readonly progress: number;
  /** Signed pointer velocity in px/ms: positive means the pointer moved right. */
  readonly velocity: number;
  readonly dir: -1 | 1;
}

export function resolveSwitchCommit(input: SwitchCommitInput): boolean {
  if (clampProgress(input.progress) >= TAB_SWITCH_COMMIT_PROGRESS) return true;
  // dir +1 ("next") is dragged toward the left, so its matching velocity is negative.
  const directionalVelocity = input.dir === 1 ? -input.velocity : input.velocity;
  return directionalVelocity >= TAB_SWITCH_FLICK_VELOCITY;
}

/** Stable identity for an ordered Tab list; `\u0000` cannot appear in generated ids. */
export function tabIdsKey(tabs: ReadonlyArray<{ readonly id: string }>): string {
  return tabs.map((tab) => tab.id).join("\u0000");
}

let transitionState: TabTransitionState | null = null;
let transitionProgress = 0;
let cancelSettle: (() => void) | null = null;

function stopSettle(): void {
  cancelSettle?.();
  cancelSettle = null;
}
const stateListeners = new Set<(state: TabTransitionState | null) => void>();
const frameListeners = new Set<(frame: TabTransitionFrame | null) => void>();

function currentFrame(): TabTransitionFrame | null {
  return transitionState === null ? null : { ...transitionState, progress: transitionProgress };
}

export function getTabTransition(): TabTransitionState | null {
  return transitionState;
}

export function getTabTransitionFrame(): TabTransitionFrame | null {
  return currentFrame();
}

export function subscribeTabTransition(
  listener: (state: TabTransitionState | null) => void,
): () => void {
  stateListeners.add(listener);
  return () => {
    stateListeners.delete(listener);
  };
}

export function subscribeTabTransitionFrame(
  listener: (frame: TabTransitionFrame | null) => void,
): () => void {
  frameListeners.add(listener);
  return () => {
    frameListeners.delete(listener);
  };
}

function notifyState(): void {
  for (const listener of stateListeners) listener(transitionState);
}

function notifyFrame(): void {
  const frame = currentFrame();
  for (const listener of frameListeners) listener(frame);
}

export function beginTabTransition(state: TabTransitionState, initialProgress = 0): void {
  stopSettle();
  transitionState = state;
  transitionProgress = clampProgress(initialProgress);
  notifyState();
  notifyFrame();
}

export function setTabTransitionProgress(progress: number): void {
  if (transitionState === null) return;
  const clamped = clampProgress(progress);
  if (Math.abs(clamped - transitionProgress) < 1e-4) return;
  transitionProgress = clamped;
  notifyFrame();
}

export function endTabTransition(): void {
  stopSettle();
  transitionState = null;
  transitionProgress = 0;
  notifyState();
  notifyFrame();
}

/** Test seam: drop any in-flight transition and its listeners. */
export function resetTabTransitionForTest(): void {
  stopSettle();
  transitionState = null;
  transitionProgress = 0;
  stateListeners.clear();
  frameListeners.clear();
}

function now(): number {
  return typeof performance !== "undefined" ? performance.now() : Date.now();
}

const requestFrame = (callback: (time: number) => void): number => {
  if (typeof globalThis.requestAnimationFrame === "function") {
    return globalThis.requestAnimationFrame(callback);
  }
  return globalThis.setTimeout(() => callback(now()), 16) as unknown as number;
};

const cancelFrame = (handle: number): void => {
  if (typeof globalThis.cancelAnimationFrame === "function") {
    globalThis.cancelAnimationFrame(handle);
    return;
  }
  globalThis.clearTimeout(handle as unknown as ReturnType<typeof globalThis.setTimeout>);
};

/**
 * Settle an active transition toward 0 (cancel) or 1 (commit) with Apple fluid
 * easing, then clear it. The module owns cancellation: starting another transition
 * or settle always stops the old RAF. The returned handle only cancels this settle.
 */
export function animateTabTransitionTo(target: 0 | 1): () => void {
  stopSettle();
  if (transitionState === null) return () => {};
  if (getPrefersReducedMotion()) {
    setTabTransitionProgress(target);
    endTabTransition();
    return () => {};
  }
  const start = transitionProgress;
  if (Math.abs(target - start) < 1e-4) {
    setTabTransitionProgress(target);
    endTabTransition();
    return () => {};
  }
  const startTime = now();
  let frameId: number | null = null;
  let cancelled = false;
  const step = () => {
    if (cancelled) return;
    const elapsed = Math.min(1, (now() - startTime) / TAB_SETTLE_DURATION_MS);
    setTabTransitionProgress(start + (target - start) * settleEaseOut(elapsed));
    if (cancelled) return;
    if (elapsed < 1) {
      frameId = requestFrame(step);
    } else {
      endTabTransition();
    }
  };
  const cancel = () => {
    cancelled = true;
    if (frameId !== null) cancelFrame(frameId);
  };
  cancelSettle = cancel;
  frameId = requestFrame(step);
  return cancel;
}
