import { describe, expect, it } from "vite-plus/test";

import { resolveWorkbenchTitlebarStyle } from "./windowControlsOverlay";

describe("resolveWorkbenchTitlebarStyle", () => {
  it("reserves macOS traffic-light space for the active desktop bridge", () => {
    expect(
      resolveWorkbenchTitlebarStyle({
        hasDesktopBridge: true,
        platform: "MacIntel",
        fullscreen: false,
      }),
    ).toEqual({
      "--workspace-controls-left": "var(--desktop-window-controls-inset, 90px)",
    });
  });

  it("does not reserve native controls in browser, non-macOS, or fullscreen states", () => {
    expect(
      resolveWorkbenchTitlebarStyle({
        hasDesktopBridge: false,
        platform: "MacIntel",
        fullscreen: false,
      }),
    ).toEqual({});
    expect(
      resolveWorkbenchTitlebarStyle({
        hasDesktopBridge: true,
        platform: "Win32",
        fullscreen: false,
      }),
    ).toEqual({});
    expect(
      resolveWorkbenchTitlebarStyle({
        hasDesktopBridge: true,
        platform: "MacIntel",
        fullscreen: true,
      }),
    ).toEqual({});
  });
});
