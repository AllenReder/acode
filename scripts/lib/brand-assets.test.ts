import { describe, expect, it } from "vite-plus/test";

import { DEVELOPMENT_ICON_OVERRIDES, DEVELOPMENT_PUBLIC_ICON_OVERRIDES } from "./brand-assets.ts";

describe("development web icons", () => {
  it("copies the desktop development artwork into built daemon clients", () => {
    expect(DEVELOPMENT_ICON_OVERRIDES).toEqual([
      {
        sourceRelativePath: "assets/dev/blueprint-web-favicon.ico",
        targetRelativePath: "dist/client/favicon.ico",
      },
      {
        sourceRelativePath: "assets/dev/blueprint-web-favicon-16x16.png",
        targetRelativePath: "dist/client/favicon-16x16.png",
      },
      {
        sourceRelativePath: "assets/dev/blueprint-web-favicon-32x32.png",
        targetRelativePath: "dist/client/favicon-32x32.png",
      },
      {
        sourceRelativePath: "assets/dev/blueprint-web-apple-touch-180.png",
        targetRelativePath: "dist/client/apple-touch-icon.png",
      },
    ]);
  });

  it("copies development artwork into the web public directory", () => {
    expect(DEVELOPMENT_PUBLIC_ICON_OVERRIDES).toEqual(
      DEVELOPMENT_ICON_OVERRIDES.map((override) => ({
        ...override,
        targetRelativePath: override.targetRelativePath.replace("dist/client", "apps/web/public"),
      })),
    );
  });
});
