// @effect-diagnostics nodeBuiltinImport:off - asserts the CSS token contract from source.
import * as NodeFSP from "node:fs/promises";

import { describe, expect, it } from "vite-plus/test";

const OPAQUE_SURFACE_TOKENS = {
  sidebar: "--material-opaque-sidebar",
  topbar: "--material-opaque-topbar",
  workbench: "--material-opaque-workbench",
  overlay: "--material-opaque-overlay",
} as const;

describe("opaque material tokens", () => {
  it("gives every material region a distinct solid surface", async () => {
    const css = await NodeFSP.readFile(new URL("./index.css", import.meta.url), "utf8");
    const tokenBlock = css.slice(
      css.indexOf("html.material-stage-opaque {"),
      css.indexOf("html.material-stage-opaque .material-surface-sidebar"),
    );

    const values = Object.values(OPAQUE_SURFACE_TOKENS).map((token) => {
      const match = tokenBlock.match(new RegExp(`${token}:\\s*([^;]+);`));
      expect(match, `${token} must be declared in the opaque material stage`).not.toBeNull();
      return match?.[1]?.replace(/\s+/g, " ").trim();
    });

    expect(new Set(values).size).toBe(Object.keys(OPAQUE_SURFACE_TOKENS).length);
    expect(tokenBlock).toMatch(/--material-opaque-stage:\s*color-mix\(/);
    expect(tokenBlock).toMatch(/--material-opaque-edge:\s*color-mix\(/);

    for (const [surface, token] of Object.entries(OPAQUE_SURFACE_TOKENS)) {
      expect(css).toMatch(
        new RegExp(
          `html\\.material-stage-opaque\\s+\\.material-surface-${surface}\\s*\\{[^}]*background:\\s*var\\(${token}\\)`,
          "s",
        ),
      );
    }

    expect(css).toMatch(
      /html\.material-stage-opaque,\s*html\.material-stage-opaque body,\s*html\.material-stage-opaque #root\s*\{[^}]*background:\s*var\(--material-opaque-stage/,
    );
  });
});
describe("Windows overlay material fallback", () => {
  it("replaces unsupported backdrop blur with a distinct elevated material", async () => {
    const css = await NodeFSP.readFile(new URL("./index.css", import.meta.url), "utf8");
    const start = css.indexOf("html.material-stage-windows .material-surface-overlay {");
    const end = css.indexOf("/* Native compositor blur", start);
    expect(
      start,
      "Windows overlay fallback must follow the shared overlay material",
    ).toBeGreaterThan(-1);
    expect(end, "Windows overlay fallback must be bounded by the opaque fallback").toBeGreaterThan(
      start,
    );
    const block = css.slice(start, end);

    expect(block).toMatch(/-webkit-backdrop-filter:\s*none;/);
    expect(block).toMatch(/backdrop-filter:\s*none;/);
    expect(block).toMatch(/background-image:\s*[^;]*linear-gradient/s);
    expect(block).toMatch(/var\(--surface-grain\)/);
    expect(block).toMatch(/border:\s*1px solid color-mix\(/);
    expect(block).toMatch(/box-shadow:\s*[^;]+;/s);
  });
});
