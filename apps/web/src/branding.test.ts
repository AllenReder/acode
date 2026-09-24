import { afterEach, describe, expect, it, vi } from "vite-plus/test";
import {
  formatAppDisplayName,
  resolveServerBackedAppDisplayName,
  resolveServerBackedAppStageLabel,
} from "./branding.logic";

const originalWindow = globalThis.window;

afterEach(() => {
  vi.resetModules();

  if (originalWindow === undefined) {
    Reflect.deleteProperty(globalThis, "window");
    return;
  }

  globalThis.window = originalWindow;
});

describe("branding", () => {
  it("uses injected desktop branding when available", async () => {
    Object.defineProperty(globalThis, "window", {
      configurable: true,
      value: {
        desktopBridge: {
          getAppBranding: () => ({
            baseName: "Awen",
            stageLabel: "Alpha",
            displayName: "Awen (Alpha)",
          }),
        },
      },
    });

    const branding = await import("./branding");

    expect(branding.APP_BASE_NAME).toBe("Awen");
    expect(branding.APP_STAGE_LABEL).toBe("Alpha");
    expect(branding.APP_DISPLAY_NAME).toBe("Awen (Alpha)");
  });
});

describe("branding logic", () => {
  it("uses the product name alone for stable builds", () => {
    expect(formatAppDisplayName({ baseName: "Awen", stageLabel: "Stable" })).toBe("Awen");
  });

  it("returns Alpha for prerelease primary server versions", () => {
    expect(
      resolveServerBackedAppStageLabel({
        primaryServerVersion: "0.1.0-alpha.1",
        fallbackStageLabel: "Dev",
      }),
    ).toBe("Alpha");
  });

  it("updates the display name for prerelease primary server versions", () => {
    expect(
      resolveServerBackedAppDisplayName({
        baseName: "Awen",
        fallbackDisplayName: "Awen (Dev)",
        fallbackStageLabel: "Dev",
        primaryServerVersion: "0.1.0-alpha.1",
      }),
    ).toBe("Awen (Alpha)");
  });

  it("keeps the fallback display name for stable primary server versions", () => {
    expect(
      resolveServerBackedAppDisplayName({
        baseName: "Awen",
        fallbackDisplayName: "Awen (Alpha)",
        fallbackStageLabel: "Alpha",
        primaryServerVersion: "0.0.27",
      }),
    ).toBe("Awen (Alpha)");
  });

  it("keeps the fallback display name for malformed prerelease versions", () => {
    expect(
      resolveServerBackedAppDisplayName({
        baseName: "Awen",
        fallbackDisplayName: "Awen (Dev)",
        fallbackStageLabel: "Dev",
        primaryServerVersion: "0.1.0-alpha.01",
      }),
    ).toBe("Awen (Dev)");
  });
});
