/**
 * Pure decision helpers for the right-button Layout pan and the wheel-driven
 * Sliding Tab switch. DOM-free so they can be exercised directly.
 */

export interface PanPhaseInput {
  readonly startScrollLeft: number;
  /** Signed pointer travel since press; positive means the pointer moved right. */
  readonly dragX: number;
  readonly maxScrollLeft: number;
}

export interface PanPhaseResult {
  scrollLeft: number;
  /** Pixels the layout could not consume; this becomes Tab switch progress. */
  readonly overscroll: number;
}

/**
 * Map pointer travel onto a Scrolling layout's horizontal offset, reporting the
 * travel that ran past either edge as overscroll.
 */
export function resolveLayoutPan(input: PanPhaseInput): PanPhaseResult {
  const maxScrollLeft = Math.max(0, input.maxScrollLeft);
  const start = Math.min(maxScrollLeft, Math.max(0, input.startScrollLeft));
  const scrollLeft = Math.min(maxScrollLeft, Math.max(0, start - input.dragX));
  const consumed = input.dragX > 0 ? start : start - maxScrollLeft;
  const overscroll = Math.max(0, Math.abs(input.dragX) - Math.abs(consumed));
  return { scrollLeft, overscroll };
}

export interface HorizontalWheelInput {
  readonly deltaX: number;
  readonly deltaY: number;
  readonly shiftKey: boolean;
}

/**
 * Reduce a wheel event to horizontal intent. Shift converts a vertical wheel to
 * horizontal because Windows and Chrome do not reliably synthesize `deltaX`.
 */
export function resolveHorizontalIntent(event: HorizontalWheelInput): number {
  if (event.shiftKey && Math.abs(event.deltaY) > Math.abs(event.deltaX)) {
    return event.deltaY;
  }
  return event.deltaX;
}

export function normalizeWheelDelta(
  delta: number,
  deltaMode: number,
  viewportWidth: number,
): number {
  if (deltaMode === 1) return delta * 16;
  if (deltaMode === 2) return delta * Math.max(1, viewportWidth);
  return delta;
}

export interface HorizontalWheelLike {
  readonly deltaX: number;
  readonly deltaY: number;
  readonly deltaMode: number;
  readonly shiftKey: boolean;
  readonly ctrlKey: boolean;
}

/**
 * Normalized horizontal wheel delta, or 0 when the gesture is not horizontal.
 * A non-shift wheel that is mostly vertical is content scrolling, not navigation.
 */
export function resolveHorizontalWheelDelta(
  event: HorizontalWheelLike,
  viewportWidth: number,
): number {
  if (event.ctrlKey) return 0;
  const intent = resolveHorizontalIntent(event);
  if (Math.abs(intent) < 1) return 0;
  if (!event.shiftKey && Math.abs(event.deltaX) <= Math.abs(event.deltaY)) return 0;
  return normalizeWheelDelta(intent, event.deltaMode, viewportWidth);
}

/** +1 advances to the next Tab; -1 moves to the previous Tab. */
export function resolveWheelSwitchDirection(horizontalDelta: number): -1 | 1 {
  return horizontalDelta > 0 ? 1 : -1;
}

export interface ScrollMetrics {
  scrollLeft: number;
  readonly clientWidth: number;
  readonly scrollWidth: number;
}

export function hasHorizontalScrollRoom(element: ScrollMetrics, delta: number): boolean {
  const max = Math.max(0, element.scrollWidth - element.clientWidth);
  if (max <= 1) return false;
  if (delta > 0) return element.scrollLeft < max - 1;
  if (delta < 0) return element.scrollLeft > 1;
  return false;
}

function isScrollElement(node: Element): node is Element & ScrollMetrics {
  const candidate = node as Partial<ScrollMetrics>;
  return (
    typeof candidate.scrollLeft === "number" &&
    typeof candidate.clientWidth === "number" &&
    typeof candidate.scrollWidth === "number"
  );
}

function isHorizontallyScrollable(node: Element): boolean {
  if (typeof getComputedStyle !== "function") return true;
  const style = getComputedStyle(node);
  return /auto|scroll|overlay/.test(style.overflowX);
}

/**
 * Walk from the wheel target up to the Workbench stage. Any horizontal scroller
 * that still has room in the gesture direction keeps the wheel for itself.
 */
export function findHorizontalScroller(
  target: Element | null,
  root: Element,
  delta: number,
): (Element & ScrollMetrics) | null {
  let node: Element | null = target;
  while (node !== null && node !== root) {
    if (
      isScrollElement(node) &&
      hasHorizontalScrollRoom(node, delta) &&
      isHorizontallyScrollable(node)
    ) {
      return node;
    }
    node = node.parentElement;
  }
  return null;
}
