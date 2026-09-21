import { describe, expect, it } from "vite-plus/test";
import {
  BASE_SPACING,
  TITLEBAR_BUTTON_SIZE,
  TRAFFIC_LIGHTS_WIDTH,
  TRAFFIC_LIGHTS_ZONE,
  COLLAPSED_TABS_INSET_MAC,
  COLLAPSED_TABS_INSET_WIN,
  EXPANDED_TABS_INSET,
  resolveSidebarMinimumWidth,
  resolveSidebarHeaderInsets,
} from "./sidebarGeometry";

describe("sidebarGeometry", () => {
  it("defines the standard spacing constant S derived from traffic light offset", () => {
    expect(BASE_SPACING).toBe(12);
    expect(TRAFFIC_LIGHTS_WIDTH).toBe(52);
    expect(TRAFFIC_LIGHTS_ZONE).toBe(64);
    expect(TITLEBAR_BUTTON_SIZE).toBe(28);
    expect(COLLAPSED_TABS_INSET_MAC).toBe(168);
    expect(COLLAPSED_TABS_INSET_WIN).toBe(92);
    expect(EXPANDED_TABS_INSET).toBe(12);
  });

  it("calculates macOS sidebar minimum width matching the unified formula", () => {
    // Traffic zone (64) + S (12) + HideBtn (28) + S (12) + SettingsBtn (28) + S (12) = 156
    const minWidth = resolveSidebarMinimumWidth({ isMac: true });
    expect(minWidth).toBe(156);
  });

  it("calculates non-macOS sidebar minimum width aligned directly to left window boundary", () => {
    // HideBtn (28) + S (12) + SettingsBtn (28) + S (12) = 80
    const minWidth = resolveSidebarMinimumWidth({ isMac: false });
    expect(minWidth).toBe(80);
  });

  it("resolves header insets for macOS and non-macOS platforms", () => {
    const macInsets = resolveSidebarHeaderInsets({ isMac: true });
    expect(macInsets.sidebarTriggerLeft).toBe(76); // 64 + 12
    expect(macInsets.buttonGap).toBe(12);
    expect(macInsets.rightInset).toBe(12);
    expect(macInsets.titlebarHeight).toBe(36);

    const winInsets = resolveSidebarHeaderInsets({ isMac: false });
    expect(winInsets.sidebarTriggerLeft).toBe(0);
    expect(winInsets.buttonGap).toBe(12);
    expect(winInsets.rightInset).toBe(12);
    expect(winInsets.titlebarHeight).toBe(36);
  });
});
