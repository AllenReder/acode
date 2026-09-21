import { describe, expect, it } from "vite-plus/test";
import {
  BASE_SPACING,
  TRAFFIC_LIGHT_GAP,
  BUTTON_GAP,
  TITLEBAR_BUTTON_SIZE,
  TRAFFIC_LIGHTS_WIDTH,
  TRAFFIC_LIGHTS_ZONE,
  DOCK_LEFT_MAC,
  DOCK_LEFT_WIN,
  COLLAPSED_TABS_INSET_MAC,
  COLLAPSED_TABS_INSET_WIN,
  EXPANDED_TABS_INSET,
  resolveSidebarMinimumWidth,
  resolveSidebarHeaderInsets,
} from "./sidebarGeometry";

describe("sidebarGeometry", () => {
  it("defines independent traffic light gap and button gap", () => {
    expect(BASE_SPACING).toBe(12);
    expect(TRAFFIC_LIGHT_GAP).toBe(12);
    expect(BUTTON_GAP).toBe(6);
    expect(TRAFFIC_LIGHTS_WIDTH).toBe(52);
    expect(TRAFFIC_LIGHTS_ZONE).toBe(64);
    expect(TITLEBAR_BUTTON_SIZE).toBe(28);
    expect(DOCK_LEFT_MAC).toBe(110); // 76 + 28 + 6
    expect(DOCK_LEFT_WIN).toBe(34);  // 0 + 28 + 6
    expect(COLLAPSED_TABS_INSET_MAC).toBe(162);
    expect(COLLAPSED_TABS_INSET_WIN).toBe(86);
    expect(EXPANDED_TABS_INSET).toBe(12);
  });

  it("calculates macOS sidebar minimum width matching the unified formula", () => {
    // Traffic zone (64) + TrafficGap (12) + HideBtn (28) + BUTTON_GAP (6) + SettingsBtn (28) + S (12) = 150
    const minWidth = resolveSidebarMinimumWidth({ isMac: true });
    expect(minWidth).toBe(150);
  });

  it("calculates non-macOS sidebar minimum width aligned directly to left window boundary", () => {
    // HideBtn (28) + BUTTON_GAP (6) + SettingsBtn (28) + S (12) = 74
    const minWidth = resolveSidebarMinimumWidth({ isMac: false });
    expect(minWidth).toBe(74);
  });

  it("resolves header insets for macOS and non-macOS platforms", () => {
    const macInsets = resolveSidebarHeaderInsets({ isMac: true });
    expect(macInsets.sidebarTriggerLeft).toBe(76); // 64 + 12
    expect(macInsets.buttonGap).toBe(6);
    expect(macInsets.rightInset).toBe(12);
    expect(macInsets.titlebarHeight).toBe(36);

    const winInsets = resolveSidebarHeaderInsets({ isMac: false });
    expect(winInsets.sidebarTriggerLeft).toBe(0);
    expect(winInsets.buttonGap).toBe(6);
    expect(winInsets.rightInset).toBe(12);
    expect(winInsets.titlebarHeight).toBe(36);
  });
});
