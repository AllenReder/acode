import { DEFAULT_CLIENT_SETTINGS } from "@awen/contracts/settings";
import { afterEach, expect, it, vi } from "vite-plus/test";

import { __setClientSettingsForTests } from "../hooks/useSettings";
import { scaledMotionDuration, skipAutomaticWorkbenchMotion } from "./workbenchMotion";

afterEach(() => {
  __setClientSettingsForTests(DEFAULT_CLIENT_SETTINGS);
  vi.unstubAllGlobals();
});

it("scales automatic motion continuously and disables it at zero", () => {
  vi.stubGlobal("window", { matchMedia: () => ({ matches: false }) });
  for (const [scale, duration] of [
    [0, 0],
    [0.37, 74],
    [1, 200],
    [2, 400],
  ] as const) {
    __setClientSettingsForTests({ ...DEFAULT_CLIENT_SETTINGS, animationDurationScale: scale });
    expect(scaledMotionDuration(200)).toBeCloseTo(duration);
    expect(skipAutomaticWorkbenchMotion()).toBe(scale === 0);
  }
});

it("keeps the system reduced-motion preference authoritative", () => {
  vi.stubGlobal("window", { matchMedia: () => ({ matches: true }) });
  __setClientSettingsForTests({ ...DEFAULT_CLIENT_SETTINGS, animationDurationScale: 2 });
  expect(scaledMotionDuration(200)).toBe(0);
  expect(skipAutomaticWorkbenchMotion()).toBe(true);
});
