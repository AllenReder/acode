/**
 * Canonical spacing and geometry rules for the full-height Sidebar and Workbench window chrome.
 * S is the standard unit of spacing derived from the macOS window edge to traffic lights offset.
 */

export const BASE_SPACING = 12; // 默认基准间距（红绿灯外边距、控件距右边界）
export const TRAFFIC_LIGHTS_WIDTH = 52; // 3 circles (12px each) + 2 gaps (8px each)
export const TRAFFIC_LIGHTS_ZONE = BASE_SPACING + TRAFFIC_LIGHTS_WIDTH; // 64px
export const TITLEBAR_BUTTON_SIZE = 28; // 28px control size
export const WORKBENCH_TITLEBAR_HEIGHT = 36; // 36px standard titlebar height

/**
 * 侧边栏隐藏按钮与设置按钮之间的间距 (Button Gap)
 * 默认 6px（macOS 原生工具栏按钮标准紧凑间距，可随意调整为 4px、6px、8px 等）。
 */
export const BUTTON_GAP = 6;

/** 侧边栏按钮在 macOS 上的起点坐标（红绿灯右侧） */
export const SIDEBAR_TRIGGER_LEFT_MAC = TRAFFIC_LIGHTS_ZONE + BASE_SPACING; // 76px
export const SIDEBAR_TRIGGER_LEFT_WIN = 0; // Windows 上对齐窗口左侧

/** 设置按钮在折叠停靠时的起点坐标（自动根据 BUTTON_GAP 联动计算） */
export const DOCK_LEFT_MAC = SIDEBAR_TRIGGER_LEFT_MAC + TITLEBAR_BUTTON_SIZE + BUTTON_GAP; // 76 + 28 + 6 = 110px
export const DOCK_LEFT_WIN = SIDEBAR_TRIGGER_LEFT_WIN + TITLEBAR_BUTTON_SIZE + BUTTON_GAP; // 0 + 28 + 6 = 34px

/**
 * Minimum sidebar width:
 * macOS: TRAFFIC_LIGHTS_ZONE (64) + S (12) + HideBtn (28) + BUTTON_GAP (6) + SettingsBtn (28) + S (12) = 150px.
 * Non-macOS: Directly aligned to window left boundary: HideBtn (28) + BUTTON_GAP (6) + SettingsBtn (28) + S (12) = 74px.
 */
export function resolveSidebarMinimumWidth(options: { readonly isMac: boolean }): number {
  if (options.isMac) {
    return (
      TRAFFIC_LIGHTS_ZONE +
      BASE_SPACING +
      TITLEBAR_BUTTON_SIZE +
      BUTTON_GAP +
      TITLEBAR_BUTTON_SIZE +
      BASE_SPACING
    );
  }
  return (
    TITLEBAR_BUTTON_SIZE +
    BUTTON_GAP +
    TITLEBAR_BUTTON_SIZE +
    BASE_SPACING
  );
}

/** Left spacer width for the Workbench tabs container when the sidebar is collapsed */
export const COLLAPSED_TABS_INSET_MAC =
  DOCK_LEFT_MAC + TITLEBAR_BUTTON_SIZE + BASE_SPACING + BASE_SPACING; // 110 + 28 + 12 + 12 = 162px

export const COLLAPSED_TABS_INSET_WIN =
  DOCK_LEFT_WIN + TITLEBAR_BUTTON_SIZE + BASE_SPACING + BASE_SPACING; // 34 + 28 + 12 + 12 = 86px

export const EXPANDED_TABS_INSET = BASE_SPACING; // 12px

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
    sidebarTriggerLeft: options.isMac ? SIDEBAR_TRIGGER_LEFT_MAC : SIDEBAR_TRIGGER_LEFT_WIN,
    buttonGap: BUTTON_GAP,
    buttonSize: TITLEBAR_BUTTON_SIZE,
    rightInset: BASE_SPACING,
    titlebarHeight: WORKBENCH_TITLEBAR_HEIGHT,
  };
}
