import type { ITheme } from "@xterm/xterm";

export interface TerminalPaletteConfig {
  background: string;
  foreground: string;
  cursor: string;
  selectionBackground?: string;
  selectionForeground?: string;
  isDark: boolean;
}

export const darkTerminalAnsi = {
  black: "#18181b",
  red: "#e07070",
  green: "#5dba80",
  yellow: "#d4a44a",
  blue: "#6a9de0",
  magenta: "#b07ad0",
  cyan: "#4aabb8",
  white: "#d4d4d8",
  brightBlack: "#434645",
  brightRed: "#e89090",
  brightGreen: "#7ecf9a",
  brightYellow: "#e0be6e",
  brightBlue: "#8ab4e8",
  brightMagenta: "#c49ae0",
  brightCyan: "#6ec2cc",
  brightWhite: "#f0f0f2",
} as const;

export const lightTerminalAnsi = {
  black: "#1a1a1e",
  red: "#dc2626",
  green: "#16a34a",
  yellow: "#ca8a04",
  blue: "#2563eb",
  magenta: "#9333ea",
  cyan: "#0891b2",
  white: "#ffffff",
  brightBlack: "#71717a",
  brightRed: "#ef4444",
  brightGreen: "#22c55e",
  brightYellow: "#f59e0b",
  brightBlue: "#3b82f6",
  brightMagenta: "#a855f7",
  brightCyan: "#06b6d4",
  brightWhite: "#fafafa",
} as const;

export function buildXtermTheme(config: TerminalPaletteConfig): ITheme {
  const ansi = config.isDark ? darkTerminalAnsi : lightTerminalAnsi;
  return {
    // The Workbench supplies the canvas, even with glass disabled. ANSI cell
    // backgrounds remain intact; only the terminal's default fill is clear.
    background: "#00000000",
    foreground: config.foreground,
    cursor: config.cursor,
    cursorAccent: config.background,
    selectionBackground:
      config.selectionBackground ??
      (config.isDark ? "rgba(255, 255, 255, 0.2)" : "rgba(0, 0, 0, 0.15)"),
    selectionForeground: config.selectionForeground ?? config.foreground,
    ...ansi,
  };
}
