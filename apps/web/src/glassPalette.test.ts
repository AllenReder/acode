import { describe, expect, it } from "vite-plus/test";
import { converter, parse } from "culori";
import { BUILT_IN_THEMES } from "@awen/shared/themePalettes";
import { getThemeColorsForMode } from "./themePalette";

const rgb = converter("rgb");
function channels(value: string): number[] {
  const color = rgb(parse(value))!;
  return [color.r, color.g, color.b];
}
function luminance(color: number[]) {
  const linear = color.map((c) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
  return linear[0]! * 0.2126 + linear[1]! * 0.7152 + linear[2]! * 0.0722;
}
function contrast(a: number[], b: number[]) {
  const first = luminance(a),
    second = luminance(b);
  return (Math.max(first, second) + 0.05) / (Math.min(first, second) + 0.05);
}

describe("built-in glass text hierarchy", () => {
  for (const theme of BUILT_IN_THEMES) {
    for (const mode of ["light", "dark"] as const) {
      it(`${theme.id} ${mode} keeps active text readable over default glass`, () => {
        const colors = getThemeColorsForMode(theme, mode)!;
        // Light desktop behind dark glass matches the reported Mac screenshot.
        // Medium desktop behind light glass verifies the other tint direction.
        const desktop = mode === "dark" ? 1 : 0.5;
        const mask = mode === "dark" ? 0.35 : 0.1;
        const maskedDesktop = desktop * (1 - mask) + (mode === "light" ? mask : 0);
        for (const [surface, text] of [
          ["canvas", "text"],
          ["canvas", "mutedForeground"],
          ["canvas", "secondaryLabel"],
          ["sidebar", "sidebarForeground"],
          ["sidebar", "sidebarMutedForeground"],
        ] as const) {
          const background = channels(colors[surface]).map((c) => c * 0.5 + maskedDesktop * 0.5);
          expect(
            contrast(channels(colors[text]), background),
            `${surface}/${text}`,
          ).toBeGreaterThanOrEqual(4.5);
        }
      });
    }
  }
});
