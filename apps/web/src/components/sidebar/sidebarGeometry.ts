/**
 * Canonical spacing and geometry rules for the full-height Sidebar and Workbench window chrome.
 * S is the standard unit of spacing derived from the macOS window edge to traffic lights offset.
 */

export const BASE_SPACING = 12; // S = 12px
export const TRAFFIC_LIGHTS_WIDTH = 52; // 3 circles (12px each) + 2 gaps (8px each)
export const TRAFFIC_LIGHTS_ZONE = BASE_SPACING + TRAFFIC_LIGHTS_WIDTH; // 64px
export const TITLEBAR_BUTTON_SIZE = 28; // 28px control size
export const WORKBENCH_TITLEBAR_HEIGHT = 36; // 36px standard titlebar height

/**
 * Minimum sidebar width:
 * macOS: TRAFFIC_LIGHTS_ZONE (64) + S (12) + HideBtn (28) + S (12) + SettingsBtn (28) + S (12) = 156px.
 * When the sidebar is dragged to this minimum width, the gap between the two buttons exactly equals S.
 * Non-macOS: Directly aligned to window left boundary: HideBtn (28) + S (12) + SettingsBtn (28) + S (12) = 80px.
 */
export function resolveSidebarMinimumWidth(options: { readonly isMac: boolean }): number {
  if (options.isMac) {
    return (
      TRAFFIC_LIGHTS_ZONE +
      BASE_SPACING +
      TITLEBAR_BUTTON_SIZE +
      BASE_SPACING +
      TITLEBAR_BUTTON_SIZE +
      BASE_SPACING
    );
  }
  return (
    TITLEBAR_BUTTON_SIZE +
    BASE_SPACING +
    TITLEBAR_BUTTON_SIZE +
    BASE_SPACING
  );
}

export interface SidebarHeaderInsets {
  readonly trafficLightsInset: number;
  readonly sidebarTriggerLeft: number;
  readonly buttonGap: number;
  readonly buttonSize: number;
  readonly rightInset: number;
  readonly titlebarHeight: number;
}

export function resolveSidebarHeaderInsets(options: { readonly isMac: boolean }): SidebarHeaderInsets {
  return {
    trafficLightsInset: options.isMac ? BASE_SPACING : 0,
    sidebarTriggerLeft: options.isMac ? TRAFFIC_LIGHTS_ZONE + BASE_SPACING : 0,
    buttonGap: BASE_SPACING,
    buttonSize: TITLEBAR_BUTTON_SIZE,
    rightInset: BASE_SPACING,
    titlebarHeight: WORKBENCH_TITLEBAR_HEIGHT,
  };
}
