import { cancelMotionFrame, requestMotionFrame, stepCriticallyDamped } from "./motionValue";

export interface PaneRect {
  readonly left: number;
  readonly top: number;
  readonly width: number;
  readonly height: number;
}

type RectKey = keyof PaneRect;
const keys: ReadonlyArray<RectKey> = ["left", "top", "width", "height"];

/** Animates real geometry so View text and terminal surfaces are never scaled. */
export function createPaneRectMotion(element: HTMLElement, initial: PaneRect) {
  const position = { ...initial };
  const velocity: Record<RectKey, number> = { left: 0, top: 0, width: 0, height: 0 };
  let target = { ...initial };
  let frame: number | null = null;
  let previousTime = 0;
  const write = () => {
    for (const key of keys) element.style[key] = `${position[key]}px`;
  };
  const stop = () => {
    if (frame !== null) cancelMotionFrame(frame);
    frame = null;
  };
  const step = (time: number) => {
    frame = null;
    const seconds = Math.max((time - previousTime) / 1000, 0);
    previousTime = time;
    let moving = false;
    for (const key of keys) {
      const stepped = stepCriticallyDamped(position[key], velocity[key], target[key], seconds, 24);
      position[key] = stepped.value;
      velocity[key] = stepped.velocity;
      if (Math.abs(position[key] - target[key]) < 0.05 && Math.abs(velocity[key]) < 0.5) {
        position[key] = target[key];
        velocity[key] = 0;
      } else moving = true;
    }
    write();
    if (moving) frame = requestMotionFrame(step);
  };
  return {
    retarget(next: PaneRect, direct: boolean) {
      target = { ...next };
      if (direct) {
        stop();
        Object.assign(position, next);
        for (const key of keys) velocity[key] = 0;
        write();
        return;
      }
      write();
      if (frame === null && keys.some((key) => Math.abs(position[key] - next[key]) > 0.05)) {
        previousTime = performance.now();
        frame = requestMotionFrame(step);
      }
    },
    stop,
  };
}
