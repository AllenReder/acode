/**
 * Canonical spacing and geometry rules for the full-height Sidebar and Workbench window chrome.
 * S is the standard unit of spacing derived from the macOS window edge to traffic lights offset.
 */

export const BASE_SPACING = 12; // 默认基准间距（红绿灯距窗口左边界 12px，控件距窗口/侧边栏右边界 12px）
export const TRAFFIC_LIGHTS_WIDTH = 52; // 3 circles (12px each) + 2 gaps (8px each)
export const TRAFFIC_LIGHTS_ZONE = BASE_SPACING + TRAFFIC_LIGHTS_WIDTH; // 64px
export const TITLEBAR_BUTTON_SIZE = 28; // 按钮尺寸 28x28
export const WORKBENCH_TITLEBAR_HEIGHT = 36; // 顶栏高度 36px

/**
 * 1. 红绿灯与最左侧隐藏按钮的间距 (Traffic Light Gap)
 * 默认 12px（红绿灯右边界 64px + 12px = 隐藏按钮起点 76px）。
 */
export const TRAFFIC_LIGHT_GAP = 12;

/**
 * 2. 隐藏按钮与设置按钮之间的间距 (Button Gap)
 * 默认 6px（仅控制两枚按钮之间的距离，不影响红绿灯）。
 */
export const BUTTON_GAP = 6;

/** 侧边栏隐藏按钮在 macOS 上的起点坐标（仅由红绿灯宽度 + TRAFFIC_LIGHT_GAP 决定） */
export const SIDEBAR_TRIGGER_LEFT_MAC = TRAFFIC_LIGHTS_ZONE + TRAFFIC_LIGHT_GAP; // 64 + 12 = 76px
export const SIDEBAR_TRIGGER_LEFT_WIN = 0; // Windows 上对齐窗口左侧

/** 设置按钮在折叠停靠时的起点坐标（自动根据 BUTTON_GAP 联动计算） */
export const DOCK_LEFT_MAC = SIDEBAR_TRIGGER_LEFT_MAC + TITLEBAR_BUTTON_SIZE + BUTTON_GAP; // 76 + 28 + 6 = 110px
export const DOCK_LEFT_WIN = SIDEBAR_TRIGGER_LEFT_WIN + TITLEBAR_BUTTON_SIZE + BUTTON_GAP; // 0 + 28 + 6 = 34px

/**
 * Minimum sidebar width:
 * macOS: TRAFFIC_LIGHTS_ZONE (64) + TRAFFIC_LIGHT_GAP (12) + HideBtn (28) + BUTTON_GAP (6) + SettingsBtn (28) + BASE_SPACING (12) = 150px.
 * Non-macOS: Directly aligned to window left boundary: HideBtn (28) + BUTTON_GAP (6) + SettingsBtn (28) + BASE_SPACING (12) = 74px.
 */
export function resolveSidebarMinimumWidth(options: { readonly isMac: boolean }): number {
  if (options.isMac) {
    return (
      TRAFFIC_LIGHTS_ZONE +
      TRAFFIC_LIGHT_GAP +
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
