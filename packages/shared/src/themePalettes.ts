export const BUILT_IN_THEME_IDS = [
  "awen-default",
  "zinc",
  "slate",
  "midnight",
  "forest",
  "ocean",
] as const;

export const DEFAULT_BUILT_IN_THEME_ID = "awen-default";

/** The mobile app default theme ID */
export const MOBILE_DEFAULT_THEME_ID = "awen-default";

export const MOBILE_THEME_IDS = [MOBILE_DEFAULT_THEME_ID, ...BUILT_IN_THEME_IDS] as const;

export const RESERVED_THEME_IDS: ReadonlySet<string> = new Set([
  "system",
  "light",
  "dark",
  ...BUILT_IN_THEME_IDS,
]);

export const UNPUBLISHABLE_THEME_IDS: ReadonlySet<string> = new Set([
  ...RESERVED_THEME_IDS,
  MOBILE_DEFAULT_THEME_ID,
]);

export type BuiltInThemeId = (typeof BUILT_IN_THEME_IDS)[number];
export type MobileThemeId = (typeof MOBILE_THEME_IDS)[number];
export type ThemeAppearance = "light" | "dark";

export const THEME_COLOR_ROLES = [
  "canvas",
  "chrome",
  "toolbar",
  "toolbarForeground",
  "toolbarBorder",
  "toolbarControl",
  "toolbarControlForeground",
  "toolbarControlHover",
  "surface",
  "surfaceRaised",
  "surfaceOverlay",
  "text",
  "textMuted",
  "border",
  "input",
  "focus",
  "accent",
  "accentForeground",
  "secondary",
  "secondaryForeground",
  "muted",
  "mutedForeground",
  "placeholder",
  "secondaryLabel",
  "iconMuted",
  "error",
  "errorForeground",
  "errorSurface",
  "warning",
  "warningForeground",
  "warningSurface",
  "update",
  "updateForeground",
  "updateSurface",
  "accentSurface",
  "accentSurfaceForeground",
  "messageSurface",
  "messageForeground",
  "messageAction",
  "messageActionForeground",
  "messageActionHover",
  "codeBackground",
  "codeForeground",
  "sidebar",
  "sidebarForeground",
  "sidebarMutedForeground",
  "sidebarControlSurface",
  "sidebarRowHover",
  "sidebarRowActive",
  "sidebarRowSelected",
  "sidebarBorder",
  "terminalBackground",
  "terminalForeground",
  "terminalCursor",
  "terminalSelection",
  "terminalScrollbar",
  "terminalScrollbarHover",
] as const;

export type ThemeColorRole = (typeof THEME_COLOR_ROLES)[number];
export type ThemeColors = Readonly<Record<ThemeColorRole, string>>;
export type ThemeVariants = Readonly<Partial<Record<ThemeAppearance, ThemeColors>>>;
export type ThemeDefinition = Readonly<{
  id: string;
  label: string;
  appearance: ThemeAppearance;
  colors: ThemeColors;
  variants?: ThemeVariants;
  collection?: Readonly<{ id: string; label: string }>;
  sidebarArtwork?: boolean;
  managed?: boolean;
}>;

function createPalette(base: {
  dark: {
    canvas: string;
    chrome: string;
    toolbar: string;
    toolbarBorder: string;
    toolbarControl: string;
    surface: string;
    surfaceRaised: string;
    surfaceOverlay: string;
    border: string;
    input: string;
    accent: string;
    accentForeground: string;
    sidebar: string;
    sidebarBorder: string;
    sidebarControlSurface: string;
    codeBackground: string;
    terminalBackground: string;
    terminalSelection: string;
  };
  light: {
    canvas: string;
    chrome: string;
    toolbar: string;
    toolbarBorder: string;
    toolbarControl: string;
    surface: string;
    surfaceRaised: string;
    surfaceOverlay: string;
    border: string;
    input: string;
    accent: string;
    accentForeground: string;
    sidebar: string;
    sidebarBorder: string;
    sidebarControlSurface: string;
    codeBackground: string;
    terminalBackground: string;
    terminalSelection: string;
  };
}): { dark: ThemeColors; light: ThemeColors } {
  const dark: ThemeColors = {
    canvas: base.dark.canvas,
    chrome: base.dark.chrome,
    toolbar: base.dark.toolbar,
    toolbarForeground: "oklch(0.96 0.005 260)",
    toolbarBorder: base.dark.toolbarBorder,
    toolbarControl: base.dark.toolbarControl,
    toolbarControlForeground: "oklch(0.96 0.005 260)",
    toolbarControlHover: "oklch(0.32 0.012 260)",
    surface: base.dark.surface,
    surfaceRaised: base.dark.surfaceRaised,
    surfaceOverlay: base.dark.surfaceOverlay,
    text: "oklch(0.96 0.005 260)",
    textMuted: "oklch(0.9 0.005 260)",
    border: base.dark.border,
    input: base.dark.input,
    focus: base.dark.accent,
    accent: base.dark.accent,
    accentForeground: base.dark.accentForeground,
    secondary: base.dark.toolbarControl,
    secondaryForeground: "oklch(0.96 0.005 260)",
    muted: "oklch(0.28 0.008 260)",
    mutedForeground: "oklch(0.9 0.005 260)",
    placeholder: "oklch(0.85 0.005 260)",
    secondaryLabel: "oklch(0.9 0.005 260)",
    iconMuted: "oklch(0.9 0.005 260)",
    error: "oklch(0.65 0.22 25)",
    errorForeground: "oklch(0.7 0.18 25)",
    errorSurface: "oklch(0.28 0.04 25)",
    warning: "oklch(0.78 0.16 70)",
    warningForeground: "oklch(0.82 0.16 80)",
    warningSurface: "oklch(0.3 0.04 70)",
    update: base.dark.accent,
    updateForeground: "oklch(0.8 0.1 260)",
    updateSurface: "oklch(0.28 0.05 260)",
    accentSurface: "oklch(0.28 0.05 260)",
    accentSurfaceForeground: "oklch(0.96 0.005 260)",
    messageSurface: base.dark.surfaceRaised,
    messageForeground: "oklch(0.96 0.005 260)",
    messageAction: base.dark.accent,
    messageActionForeground: base.dark.accentForeground,
    messageActionHover: "oklch(0.6 0.15 260)",
    codeBackground: base.dark.codeBackground,
    codeForeground: "oklch(0.96 0.005 260)",
    sidebar: base.dark.sidebar,
    sidebarForeground: "oklch(0.96 0.005 260)",
    sidebarMutedForeground: "oklch(0.9 0.005 260)",
    sidebarControlSurface: base.dark.sidebarControlSurface,
    sidebarRowHover: "oklch(0.26 0.008 260)",
    sidebarRowActive: "oklch(0.3 0.01 260)",
    sidebarRowSelected: "oklch(0.32 0.012 260)",
    sidebarBorder: base.dark.sidebarBorder,
    terminalBackground: base.dark.terminalBackground,
    terminalForeground: "oklch(0.96 0.005 260)",
    terminalCursor: base.dark.accent,
    terminalSelection: base.dark.terminalSelection,
    terminalScrollbar: "oklch(0.3 0.008 260)",
    terminalScrollbarHover: "oklch(0.4 0.01 260)",
  };

  const light: ThemeColors = {
    canvas: base.light.canvas,
    chrome: base.light.chrome,
    toolbar: base.light.toolbar,
    toolbarForeground: "oklch(0.2 0.005 260)",
    toolbarBorder: base.light.toolbarBorder,
    toolbarControl: base.light.toolbarControl,
    toolbarControlForeground: "oklch(0.2 0.005 260)",
    toolbarControlHover: "oklch(0.9 0.005 260)",
    surface: base.light.surface,
    surfaceRaised: base.light.surfaceRaised,
    surfaceOverlay: base.light.surfaceOverlay,
    text: "oklch(0.2 0.005 260)",
    textMuted: "oklch(0.42 0.005 260)",
    border: base.light.border,
    input: base.light.input,
    focus: base.light.accent,
    accent: base.light.accent,
    accentForeground: base.light.accentForeground,
    secondary: base.light.toolbarControl,
    secondaryForeground: "oklch(0.2 0.005 260)",
    muted: "oklch(0.94 0.003 260)",
    mutedForeground: "oklch(0.42 0.005 260)",
    placeholder: "oklch(0.5 0.008 260)",
    secondaryLabel: "oklch(0.42 0.005 260)",
    iconMuted: "oklch(0.42 0.005 260)",
    error: "oklch(0.62 0.22 25)",
    errorForeground: "oklch(0.5 0.18 25)",
    errorSurface: "oklch(0.95 0.015 25)",
    warning: "oklch(0.76 0.16 70)",
    warningForeground: "oklch(0.52 0.14 60)",
    warningSurface: "oklch(0.96 0.015 70)",
    update: base.light.accent,
    updateForeground: "oklch(0.4 0.12 260)",
    updateSurface: "oklch(0.92 0.02 260)",
    accentSurface: "oklch(0.92 0.02 260)",
    accentSurfaceForeground: "oklch(0.2 0.005 260)",
    messageSurface: base.light.surfaceRaised,
    messageForeground: "oklch(0.2 0.005 260)",
    messageAction: base.light.accent,
    messageActionForeground: base.light.accentForeground,
    messageActionHover: "oklch(0.5 0.16 260)",
    codeBackground: base.light.codeBackground,
    codeForeground: "oklch(0.2 0.005 260)",
    sidebar: base.light.sidebar,
    sidebarForeground: "oklch(0.2 0.005 260)",
    sidebarMutedForeground: "oklch(0.42 0.005 260)",
    sidebarControlSurface: base.light.sidebarControlSurface,
    sidebarRowHover: "oklch(0.91 0.006 260)",
    sidebarRowActive: "oklch(0.87 0.008 260)",
    sidebarRowSelected: "oklch(0.85 0.01 260)",
    sidebarBorder: base.light.sidebarBorder,
    terminalBackground: base.light.terminalBackground,
    terminalForeground: "oklch(0.2 0.005 260)",
    terminalCursor: base.light.accent,
    terminalSelection: base.light.terminalSelection,
    terminalScrollbar: "oklch(0.84 0.005 260)",
    terminalScrollbarHover: "oklch(0.76 0.008 260)",
  };

  return { dark, light };
}

// 1. Awen Default: Monocode-inspired deep neutral dark + crisp light
const awenDefaultPalettes = createPalette({
  dark: {
    canvas: "oklch(0.2 0.005 260)",
    chrome: "oklch(0.2 0.005 260)",
    toolbar: "oklch(0.2 0.005 260)",
    toolbarBorder: "oklch(0.28 0.006 260)",
    toolbarControl: "oklch(0.26 0.008 260)",
    surface: "oklch(0.22 0.006 260)",
    surfaceRaised: "oklch(0.25 0.008 260)",
    surfaceOverlay: "oklch(0.18 0.004 260)",
    border: "oklch(0.28 0.006 260)",
    input: "oklch(0.3 0.008 260)",
    accent: "oklch(0.72 0.16 260)",
    accentForeground: "oklch(0.1 0 0)",
    sidebar: "oklch(0.18 0.005 260)",
    sidebarBorder: "oklch(0.26 0.006 260)",
    sidebarControlSurface: "oklch(0.25 0.008 260)",
    codeBackground: "oklch(0.18 0.004 260)",
    terminalBackground: "oklch(0.18 0.004 260)",
    terminalSelection: "oklch(0.32 0.02 260)",
  },
  light: {
    canvas: "oklch(0.985 0.002 260)",
    chrome: "oklch(0.985 0.002 260)",
    toolbar: "oklch(0.985 0.002 260)",
    toolbarBorder: "oklch(0.9 0.005 260)",
    toolbarControl: "oklch(0.94 0.003 260)",
    surface: "oklch(0.985 0.002 260)",
    surfaceRaised: "oklch(0.96 0.002 260)",
    surfaceOverlay: "oklch(1 0 0)",
    border: "oklch(0.88 0.005 260)",
    input: "oklch(0.84 0.008 260)",
    accent: "oklch(0.5 0.18 260)",
    accentForeground: "oklch(0.99 0 0)",
    sidebar: "oklch(0.95 0.003 260)",
    sidebarBorder: "oklch(0.88 0.005 260)",
    sidebarControlSurface: "oklch(0.9 0.005 260)",
    codeBackground: "oklch(0.96 0.002 260)",
    terminalBackground: "oklch(0.985 0.002 260)",
    terminalSelection: "oklch(0.88 0.015 260)",
  },
});

export const AWEN_DEFAULT_THEME: ThemeDefinition = {
  id: "awen-default",
  label: "Awen Default",
  appearance: "dark",
  colors: awenDefaultPalettes.dark,
  variants: {
    light: awenDefaultPalettes.light,
    dark: awenDefaultPalettes.dark,
  },
  sidebarArtwork: true,
};

// 2. Zinc: Industrial neutral zinc
const zincPalettes = createPalette({
  dark: {
    canvas: "oklch(0.21 0.002 285)",
    chrome: "oklch(0.21 0.002 285)",
    toolbar: "oklch(0.21 0.002 285)",
    toolbarBorder: "oklch(0.29 0.003 285)",
    toolbarControl: "oklch(0.27 0.004 285)",
    surface: "oklch(0.23 0.003 285)",
    surfaceRaised: "oklch(0.26 0.004 285)",
    surfaceOverlay: "oklch(0.17 0.002 285)",
    border: "oklch(0.29 0.003 285)",
    input: "oklch(0.31 0.004 285)",
    accent: "oklch(0.75 0.01 285)",
    accentForeground: "oklch(0.1 0 0)",
    sidebar: "oklch(0.18 0.002 285)",
    sidebarBorder: "oklch(0.26 0.003 285)",
    sidebarControlSurface: "oklch(0.25 0.004 285)",
    codeBackground: "oklch(0.18 0.002 285)",
    terminalBackground: "oklch(0.18 0.002 285)",
    terminalSelection: "oklch(0.33 0.005 285)",
  },
  light: {
    canvas: "oklch(0.985 0.001 285)",
    chrome: "oklch(0.985 0.001 285)",
    toolbar: "oklch(0.985 0.001 285)",
    toolbarBorder: "oklch(0.89 0.002 285)",
    toolbarControl: "oklch(0.94 0.002 285)",
    surface: "oklch(0.985 0.001 285)",
    surfaceRaised: "oklch(0.96 0.002 285)",
    surfaceOverlay: "oklch(1 0 0)",
    border: "oklch(0.88 0.002 285)",
    input: "oklch(0.84 0.003 285)",
    accent: "oklch(0.35 0.005 285)",
    accentForeground: "oklch(0.99 0 0)",
    sidebar: "oklch(0.95 0.002 285)",
    sidebarBorder: "oklch(0.88 0.002 285)",
    sidebarControlSurface: "oklch(0.9 0.002 285)",
    codeBackground: "oklch(0.96 0.001 285)",
    terminalBackground: "oklch(0.985 0.001 285)",
    terminalSelection: "oklch(0.88 0.003 285)",
  },
});

export const ZINC_THEME: ThemeDefinition = {
  id: "zinc",
  label: "Zinc",
  appearance: "dark",
  colors: zincPalettes.dark,
  variants: {
    light: zincPalettes.light,
    dark: zincPalettes.dark,
  },
  sidebarArtwork: true,
};

// 3. Slate: Cool slate blue
const slatePalettes = createPalette({
  dark: {
    canvas: "oklch(0.2 0.015 250)",
    chrome: "oklch(0.2 0.015 250)",
    toolbar: "oklch(0.2 0.015 250)",
    toolbarBorder: "oklch(0.28 0.018 250)",
    toolbarControl: "oklch(0.26 0.016 250)",
    surface: "oklch(0.22 0.015 250)",
    surfaceRaised: "oklch(0.26 0.016 250)",
    surfaceOverlay: "oklch(0.17 0.012 250)",
    border: "oklch(0.28 0.018 250)",
    input: "oklch(0.3 0.018 250)",
    accent: "oklch(0.72 0.15 240)",
    accentForeground: "oklch(0.1 0 0)",
    sidebar: "oklch(0.18 0.015 250)",
    sidebarBorder: "oklch(0.26 0.016 250)",
    sidebarControlSurface: "oklch(0.24 0.016 250)",
    codeBackground: "oklch(0.18 0.012 250)",
    terminalBackground: "oklch(0.18 0.012 250)",
    terminalSelection: "oklch(0.33 0.025 250)",
  },
  light: {
    canvas: "oklch(0.985 0.004 250)",
    chrome: "oklch(0.985 0.004 250)",
    toolbar: "oklch(0.985 0.004 250)",
    toolbarBorder: "oklch(0.89 0.008 250)",
    toolbarControl: "oklch(0.94 0.005 250)",
    surface: "oklch(0.985 0.004 250)",
    surfaceRaised: "oklch(0.96 0.005 250)",
    surfaceOverlay: "oklch(1 0 0)",
    border: "oklch(0.88 0.008 250)",
    input: "oklch(0.84 0.01 250)",
    accent: "oklch(0.48 0.16 240)",
    accentForeground: "oklch(0.99 0 0)",
    sidebar: "oklch(0.95 0.006 250)",
    sidebarBorder: "oklch(0.88 0.008 250)",
    sidebarControlSurface: "oklch(0.9 0.006 250)",
    codeBackground: "oklch(0.96 0.004 250)",
    terminalBackground: "oklch(0.985 0.004 250)",
    terminalSelection: "oklch(0.88 0.015 250)",
  },
});

export const SLATE_THEME: ThemeDefinition = {
  id: "slate",
  label: "Slate",
  appearance: "dark",
  colors: slatePalettes.dark,
  variants: {
    light: slatePalettes.light,
    dark: slatePalettes.dark,
  },
  sidebarArtwork: true,
};

// 4. Midnight: True black OLED high contrast
const midnightPalettes = createPalette({
  dark: {
    canvas: "oklch(0.12 0 0)",
    chrome: "oklch(0.12 0 0)",
    toolbar: "oklch(0.12 0 0)",
    toolbarBorder: "oklch(0.22 0 0)",
    toolbarControl: "oklch(0.2 0 0)",
    surface: "oklch(0.15 0 0)",
    surfaceRaised: "oklch(0.18 0 0)",
    surfaceOverlay: "oklch(0.1 0 0)",
    border: "oklch(0.22 0 0)",
    input: "oklch(0.24 0 0)",
    accent: "oklch(0.75 0.18 260)",
    accentForeground: "oklch(0.1 0 0)",
    sidebar: "oklch(0.1 0 0)",
    sidebarBorder: "oklch(0.2 0 0)",
    sidebarControlSurface: "oklch(0.18 0 0)",
    codeBackground: "oklch(0.1 0 0)",
    terminalBackground: "oklch(0.1 0 0)",
    terminalSelection: "oklch(0.28 0.01 260)",
  },
  light: {
    canvas: "oklch(0.99 0 0)",
    chrome: "oklch(0.99 0 0)",
    toolbar: "oklch(0.99 0 0)",
    toolbarBorder: "oklch(0.88 0 0)",
    toolbarControl: "oklch(0.94 0 0)",
    surface: "oklch(0.99 0 0)",
    surfaceRaised: "oklch(0.96 0 0)",
    surfaceOverlay: "oklch(1 0 0)",
    border: "oklch(0.88 0 0)",
    input: "oklch(0.84 0 0)",
    accent: "oklch(0.4 0.18 260)",
    accentForeground: "oklch(0.99 0 0)",
    sidebar: "oklch(0.95 0 0)",
    sidebarBorder: "oklch(0.88 0 0)",
    sidebarControlSurface: "oklch(0.9 0 0)",
    codeBackground: "oklch(0.96 0 0)",
    terminalBackground: "oklch(0.99 0 0)",
    terminalSelection: "oklch(0.88 0.01 260)",
  },
});

export const MIDNIGHT_THEME: ThemeDefinition = {
  id: "midnight",
  label: "Midnight",
  appearance: "dark",
  colors: midnightPalettes.dark,
  variants: {
    light: midnightPalettes.light,
    dark: midnightPalettes.dark,
  },
  sidebarArtwork: true,
};

// 5. Forest: Deep green/moss
const forestPalettes = createPalette({
  dark: {
    canvas: "oklch(0.21 0.022 155)",
    chrome: "oklch(0.21 0.022 155)",
    toolbar: "oklch(0.21 0.022 155)",
    toolbarBorder: "oklch(0.29 0.025 155)",
    toolbarControl: "oklch(0.27 0.022 155)",
    surface: "oklch(0.23 0.022 155)",
    surfaceRaised: "oklch(0.27 0.025 155)",
    surfaceOverlay: "oklch(0.17 0.018 155)",
    border: "oklch(0.29 0.025 155)",
    input: "oklch(0.31 0.025 155)",
    accent: "oklch(0.72 0.15 150)",
    accentForeground: "oklch(0.1 0 0)",
    sidebar: "oklch(0.18 0.02 155)",
    sidebarBorder: "oklch(0.26 0.02 155)",
    sidebarControlSurface: "oklch(0.25 0.022 155)",
    codeBackground: "oklch(0.18 0.018 155)",
    terminalBackground: "oklch(0.18 0.018 155)",
    terminalSelection: "oklch(0.33 0.035 155)",
  },
  light: {
    canvas: "oklch(0.985 0.006 155)",
    chrome: "oklch(0.985 0.006 155)",
    toolbar: "oklch(0.985 0.006 155)",
    toolbarBorder: "oklch(0.89 0.012 155)",
    toolbarControl: "oklch(0.94 0.008 155)",
    surface: "oklch(0.985 0.006 155)",
    surfaceRaised: "oklch(0.96 0.008 155)",
    surfaceOverlay: "oklch(1 0 0)",
    border: "oklch(0.88 0.012 155)",
    input: "oklch(0.84 0.015 155)",
    accent: "oklch(0.48 0.14 150)",
    accentForeground: "oklch(0.99 0 0)",
    sidebar: "oklch(0.95 0.01 155)",
    sidebarBorder: "oklch(0.88 0.012 155)",
    sidebarControlSurface: "oklch(0.9 0.01 155)",
    codeBackground: "oklch(0.96 0.006 155)",
    terminalBackground: "oklch(0.985 0.006 155)",
    terminalSelection: "oklch(0.88 0.02 155)",
  },
});

export const FOREST_THEME: ThemeDefinition = {
  id: "forest",
  label: "Forest",
  appearance: "dark",
  colors: forestPalettes.dark,
  variants: {
    light: forestPalettes.light,
    dark: forestPalettes.dark,
  },
  sidebarArtwork: true,
};

// 6. Ocean: Deep ocean indigo
const oceanPalettes = createPalette({
  dark: {
    canvas: "oklch(0.21 0.025 245)",
    chrome: "oklch(0.21 0.025 245)",
    toolbar: "oklch(0.21 0.025 245)",
    toolbarBorder: "oklch(0.29 0.028 245)",
    toolbarControl: "oklch(0.27 0.025 245)",
    surface: "oklch(0.23 0.025 245)",
    surfaceRaised: "oklch(0.27 0.028 245)",
    surfaceOverlay: "oklch(0.17 0.02 245)",
    border: "oklch(0.29 0.028 245)",
    input: "oklch(0.31 0.028 245)",
    accent: "oklch(0.72 0.16 240)",
    accentForeground: "oklch(0.1 0 0)",
    sidebar: "oklch(0.18 0.022 245)",
    sidebarBorder: "oklch(0.26 0.022 245)",
    sidebarControlSurface: "oklch(0.25 0.025 245)",
    codeBackground: "oklch(0.18 0.02 245)",
    terminalBackground: "oklch(0.18 0.02 245)",
    terminalSelection: "oklch(0.33 0.038 245)",
  },
  light: {
    canvas: "oklch(0.985 0.006 245)",
    chrome: "oklch(0.985 0.006 245)",
    toolbar: "oklch(0.985 0.006 245)",
    toolbarBorder: "oklch(0.89 0.012 245)",
    toolbarControl: "oklch(0.94 0.008 245)",
    surface: "oklch(0.985 0.006 245)",
    surfaceRaised: "oklch(0.96 0.008 245)",
    surfaceOverlay: "oklch(1 0 0)",
    border: "oklch(0.88 0.012 245)",
    input: "oklch(0.84 0.015 245)",
    accent: "oklch(0.48 0.16 240)",
    accentForeground: "oklch(0.99 0 0)",
    sidebar: "oklch(0.95 0.01 245)",
    sidebarBorder: "oklch(0.88 0.012 245)",
    sidebarControlSurface: "oklch(0.9 0.01 245)",
    codeBackground: "oklch(0.96 0.006 245)",
    terminalBackground: "oklch(0.985 0.006 245)",
    terminalSelection: "oklch(0.88 0.02 245)",
  },
});

export const OCEAN_THEME: ThemeDefinition = {
  id: "ocean",
  label: "Ocean",
  appearance: "dark",
  colors: oceanPalettes.dark,
  variants: {
    light: oceanPalettes.light,
    dark: oceanPalettes.dark,
  },
  sidebarArtwork: true,
};

export const BUILT_IN_THEMES: ReadonlyArray<ThemeDefinition> = [
  AWEN_DEFAULT_THEME,
  ZINC_THEME,
  SLATE_THEME,
  MIDNIGHT_THEME,
  FOREST_THEME,
  OCEAN_THEME,
];

export function getThemeColorsForAppearance(
  theme: ThemeDefinition,
  appearance: ThemeAppearance,
): ThemeColors | null {
  if (theme.appearance === appearance) return theme.colors;
  return theme.variants?.[appearance] ?? null;
}
