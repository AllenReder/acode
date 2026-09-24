export interface IconOverride {
  readonly sourceRelativePath: string;
  readonly targetRelativePath: string;
}

const DEVELOPMENT_WEB_ICON_PATHS = {
  faviconIco: "assets/dev/blueprint-web-favicon.ico",
  favicon16Png: "assets/dev/blueprint-web-favicon-16x16.png",
  favicon32Png: "assets/dev/blueprint-web-favicon-32x32.png",
  appleTouchIconPng: "assets/dev/blueprint-web-apple-touch-180.png",
} as const;

const WEB_ICON_TARGET_FILENAMES = {
  faviconIco: "favicon.ico",
  favicon16Png: "favicon-16x16.png",
  favicon32Png: "favicon-32x32.png",
  appleTouchIconPng: "apple-touch-icon.png",
} as const;

function developmentIconOverrides(targetDirectory: string): ReadonlyArray<IconOverride> {
  return [
    {
      sourceRelativePath: DEVELOPMENT_WEB_ICON_PATHS.faviconIco,
      targetRelativePath: `${targetDirectory}/${WEB_ICON_TARGET_FILENAMES.faviconIco}`,
    },
    {
      sourceRelativePath: DEVELOPMENT_WEB_ICON_PATHS.favicon16Png,
      targetRelativePath: `${targetDirectory}/${WEB_ICON_TARGET_FILENAMES.favicon16Png}`,
    },
    {
      sourceRelativePath: DEVELOPMENT_WEB_ICON_PATHS.favicon32Png,
      targetRelativePath: `${targetDirectory}/${WEB_ICON_TARGET_FILENAMES.favicon32Png}`,
    },
    {
      sourceRelativePath: DEVELOPMENT_WEB_ICON_PATHS.appleTouchIconPng,
      targetRelativePath: `${targetDirectory}/${WEB_ICON_TARGET_FILENAMES.appleTouchIconPng}`,
    },
  ];
}

export const DEVELOPMENT_ICON_OVERRIDES = developmentIconOverrides("dist/client");
export const DEVELOPMENT_PUBLIC_ICON_OVERRIDES = developmentIconOverrides("apps/web/public");
