export interface MotionValue {
  readonly value: number;
  readonly velocity: number;
  readonly target: number;
  setFrequency(frequency: number): void;
  setTarget(target: number): void;
  setDirect(value: number, velocity?: number): void;
  stop(): void;
  subscribe(listener: (value: number) => void): () => void;
}

export function requestMotionFrame(callback: FrameRequestCallback): number {
  return typeof globalThis.requestAnimationFrame === "function"
    ? globalThis.requestAnimationFrame(callback)
    : (globalThis.setTimeout(() => callback(performance.now()), 16) as unknown as number);
}

export function cancelMotionFrame(handle: number): void {
  if (typeof globalThis.cancelAnimationFrame === "function")
    globalThis.cancelAnimationFrame(handle);
  else globalThis.clearTimeout(handle as unknown as ReturnType<typeof globalThis.setTimeout>);
}

export function stepCriticallyDamped(
  value: number,
  velocity: number,
  target: number,
  seconds: number,
  frequency: number,
): { value: number; velocity: number } {
  const displacement = value - target;
  const decay = Math.exp(-frequency * seconds);
  const carried = (velocity + frequency * displacement) * seconds;
  const next = target + (displacement + carried) * decay;
  if (displacement !== 0 && Math.sign(next - target) !== Math.sign(displacement)) {
    return { value: target, velocity: 0 };
  }
  return { value: next, velocity: (velocity - frequency * carried) * decay };
}

/** A critically damped scalar spring. Retargeting preserves both position and velocity. */
export function createMotionValue(initial: number, frequency = 24): MotionValue {
  let currentFrequency = frequency;
  let value = initial;
  let velocity = 0;
  let target = initial;
  let frame: number | null = null;
  let previousTime = 0;
  const listeners = new Set<(value: number) => void>();
  const publish = () => {
    for (const listener of listeners) listener(value);
  };
  const cancel = () => {
    if (frame !== null) cancelMotionFrame(frame);
    frame = null;
    previousTime = 0;
  };
  const step = (time: number) => {
    frame = null;
    const seconds = Math.max((time - previousTime) / 1000, 0);
    previousTime = time;
    ({ value, velocity } = stepCriticallyDamped(
      value,
      velocity,
      target,
      seconds,
      currentFrequency,
    ));
    if (Math.abs(value - target) < 0.001 && Math.abs(velocity) < 0.03) {
      value = target;
      velocity = 0;
      publish();
      cancel();
      return;
    }
    publish();
    frame = requestMotionFrame(step);
  };
  return {
    get value() {
      return value;
    },
    get velocity() {
      return velocity;
    },
    get target() {
      return target;
    },
    setFrequency(next) {
      if (Number.isFinite(next) && next > 0) currentFrequency = next;
    },
    setTarget(next) {
      if (!Number.isFinite(next)) return;
      target = next;
      if (frame === null && (value !== target || velocity !== 0)) {
        previousTime = performance.now();
        frame = requestMotionFrame(step);
      }
    },
    setDirect(next, nextVelocity = 0) {
      if (!Number.isFinite(next)) return;
      cancel();
      value = next;
      target = next;
      velocity = Number.isFinite(nextVelocity) ? nextVelocity : 0;
      publish();
    },
    stop: cancel,
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
}
