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
 * 默认 12px（控制红绿灯右边界到隐藏按钮左边的距离）。
 */
export const TRAFFIC_LIGHT_GAP = 10;

/**
 * 2. 隐藏按钮与设置按钮之间的间距 (Button Gap)
 * 默认 6px（控制隐藏按钮与设置按钮两枚按钮之间的距离）。
 */
export const BUTTON_GAP = 2;

/**
 * 3. 折叠状态下：设置按钮与右侧细分割线之间的间距 (Separator Left Gap)
 * 默认 6px（控制设置按钮右侧到分割线的距离）。
 */
export const SEPARATOR_LEFT_GAP = 6;

/**
 * 4. 折叠状态下：细分割线与右侧第一个 Tab 之间的间距 (Separator Right Gap)
 * 默认 12px（控制分割线到 Tab 列表的距离）。
 */
export const SEPARATOR_RIGHT_GAP = 12;

/**
 * 5. 展开状态下：设置按钮与侧边栏右边界的间距 (Settings Right Margin)
 * 默认 6px（控制展开时设置按钮距离侧边栏右边界的距离）。
 */
export const SETTINGS_RIGHT_GAP = 6;

/** 展开状态下设置按钮相对于侧边栏右边界的总偏移量 (按钮宽 28px + 右外边距 SETTINGS_RIGHT_GAP) */
export const EXPANDED_ACTION_RIGHT_OFFSET = TITLEBAR_BUTTON_SIZE + SETTINGS_RIGHT_GAP; // 28 + 12 = 40px

/** 侧边栏隐藏按钮在 macOS 上的起点坐标 */
export const SIDEBAR_TRIGGER_LEFT_MAC = TRAFFIC_LIGHTS_ZONE + TRAFFIC_LIGHT_GAP; // 64 + 10 = 74px
export const SIDEBAR_TRIGGER_LEFT_WIN = 0; // Windows 上对齐窗口左侧

/** 设置按钮在折叠停靠时的起点坐标（由隐藏按钮位置 + 按钮尺寸 + BUTTON_GAP 决定） */
export const DOCK_LEFT_MAC = SIDEBAR_TRIGGER_LEFT_MAC + TITLEBAR_BUTTON_SIZE + BUTTON_GAP; // 74 + 28 + 6 = 108px
export const DOCK_LEFT_WIN = SIDEBAR_TRIGGER_LEFT_WIN + TITLEBAR_BUTTON_SIZE + BUTTON_GAP; // 0 + 28 + 6 = 34px

/**
 * Minimum sidebar width:
 * macOS: TRAFFIC_LIGHTS_ZONE (64) + TRAFFIC_LIGHT_GAP (10) + HideBtn (28) + BUTTON_GAP (6) + SettingsBtn (28) + SETTINGS_RIGHT_GAP (12) = 148px.
 * Non-macOS: Directly aligned to window left boundary: HideBtn (28) + BUTTON_GAP (6) + SettingsBtn (28) + SETTINGS_RIGHT_GAP (12) = 74px.
 */
export function resolveSidebarMinimumWidth(options: { readonly isMac: boolean }): number {
  if (options.isMac) {
    return (
      TRAFFIC_LIGHTS_ZONE +
      TRAFFIC_LIGHT_GAP +
      TITLEBAR_BUTTON_SIZE +
      BUTTON_GAP +
      TITLEBAR_BUTTON_SIZE +
      SETTINGS_RIGHT_GAP
    );
  }
  return (
    TITLEBAR_BUTTON_SIZE +
    BUTTON_GAP +
    TITLEBAR_BUTTON_SIZE +
    SETTINGS_RIGHT_GAP
  );
}

/** Left spacer width for the Workbench tabs container when the sidebar is collapsed */
export const COLLAPSED_TABS_INSET_MAC =
  DOCK_LEFT_MAC + TITLEBAR_BUTTON_SIZE + SEPARATOR_LEFT_GAP + 1 + SEPARATOR_RIGHT_GAP;

export const COLLAPSED_TABS_INSET_WIN =
  DOCK_LEFT_WIN + TITLEBAR_BUTTON_SIZE + SEPARATOR_LEFT_GAP + 1 + SEPARATOR_RIGHT_GAP;

export const EXPANDED_TABS_INSET = 0;

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
    rightInset: SETTINGS_RIGHT_GAP,
    titlebarHeight: WORKBENCH_TITLEBAR_HEIGHT,
  };
}
