import { describe, expect, it } from "vite-plus/test";
import {
  BASE_SPACING,
  TRAFFIC_LIGHT_GAP,
  BUTTON_GAP,
  SEPARATOR_LEFT_GAP,
  SEPARATOR_RIGHT_GAP,
  SETTINGS_RIGHT_GAP,
  TITLEBAR_BUTTON_SIZE,
  TRAFFIC_LIGHTS_WIDTH,
  TRAFFIC_LIGHTS_ZONE,
  SIDEBAR_TRIGGER_LEFT_MAC,
  SIDEBAR_TRIGGER_LEFT_WIN,
  DOCK_LEFT_MAC,
  DOCK_LEFT_WIN,
  COLLAPSED_TABS_INSET_MAC,
  COLLAPSED_TABS_INSET_WIN,
  EXPANDED_TABS_INSET,
  resolveSidebarMinimumWidth,
  resolveSidebarHeaderInsets,
} from "./sidebarGeometry";

describe("sidebarGeometry", () => {
  it("defines independent gaps for traffic lights, buttons, and separator", () => {
    expect(TRAFFIC_LIGHTS_WIDTH).toBe(52);
    expect(TRAFFIC_LIGHTS_ZONE).toBe(BASE_SPACING + TRAFFIC_LIGHTS_WIDTH);
    expect(TITLEBAR_BUTTON_SIZE).toBe(28);
    expect(SIDEBAR_TRIGGER_LEFT_MAC).toBe(TRAFFIC_LIGHTS_ZONE + TRAFFIC_LIGHT_GAP);
    expect(SIDEBAR_TRIGGER_LEFT_WIN).toBe(BASE_SPACING);
    expect(DOCK_LEFT_MAC).toBe(SIDEBAR_TRIGGER_LEFT_MAC + TITLEBAR_BUTTON_SIZE + BUTTON_GAP);
    expect(DOCK_LEFT_WIN).toBe(SIDEBAR_TRIGGER_LEFT_WIN + TITLEBAR_BUTTON_SIZE + BUTTON_GAP);
    expect(COLLAPSED_TABS_INSET_MAC).toBe(
      DOCK_LEFT_MAC + TITLEBAR_BUTTON_SIZE + SEPARATOR_LEFT_GAP + 1 + SEPARATOR_RIGHT_GAP,
    );
    expect(COLLAPSED_TABS_INSET_WIN).toBe(
      DOCK_LEFT_WIN + TITLEBAR_BUTTON_SIZE + SEPARATOR_LEFT_GAP + 1 + SEPARATOR_RIGHT_GAP,
    );
    expect(EXPANDED_TABS_INSET).toBe(0);
  });

  it("calculates macOS sidebar minimum width matching the unified formula", () => {
    const expected =
      TRAFFIC_LIGHTS_ZONE +
      TRAFFIC_LIGHT_GAP +
      TITLEBAR_BUTTON_SIZE +
      BUTTON_GAP +
      TITLEBAR_BUTTON_SIZE +
      SETTINGS_RIGHT_GAP;
    expect(resolveSidebarMinimumWidth({ isMac: true })).toBe(expected);
  });

  it("calculates non-macOS sidebar minimum width including base left spacing", () => {
    const expected =
      SIDEBAR_TRIGGER_LEFT_WIN +
      TITLEBAR_BUTTON_SIZE +
      BUTTON_GAP +
      TITLEBAR_BUTTON_SIZE +
      SETTINGS_RIGHT_GAP;
    expect(resolveSidebarMinimumWidth({ isMac: false })).toBe(expected);
  });

  it("resolves header insets for macOS and non-macOS platforms", () => {
    const macInsets = resolveSidebarHeaderInsets({ isMac: true });
    expect(macInsets.sidebarTriggerLeft).toBe(SIDEBAR_TRIGGER_LEFT_MAC);
    expect(macInsets.buttonGap).toBe(BUTTON_GAP);
    expect(macInsets.rightInset).toBe(SETTINGS_RIGHT_GAP);
    expect(macInsets.titlebarHeight).toBe(36);

    const winInsets = resolveSidebarHeaderInsets({ isMac: false });
    expect(winInsets.sidebarTriggerLeft).toBe(SIDEBAR_TRIGGER_LEFT_WIN);
    expect(winInsets.buttonGap).toBe(BUTTON_GAP);
    expect(winInsets.rightInset).toBe(SETTINGS_RIGHT_GAP);
    expect(winInsets.titlebarHeight).toBe(36);
  });
});
