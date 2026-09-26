import { describe, expect, it } from "vite-plus/test";
import { shouldLoadWebglRenderer, shouldXtermHandleKey } from "./surface";
import { buildXtermTheme } from "./theme";

describe("shouldXtermHandleKey", () => {
  const event = { key: "a", code: "KeyA" } as KeyboardEvent;

  it("lets xterm process a key the terminal owns", () => {
    // The drawer returns true for ordinary typing; a false here would drop
    // every keystroke while paste still worked, which is exactly the
    // "cannot type" bug this guards.
    expect(shouldXtermHandleKey(event, () => true)).toBe(true);
  });

  it("suppresses a key the host already consumed", () => {
    expect(shouldXtermHandleKey(event, () => false)).toBe(false);
  });

  it("defaults to letting xterm handle keys when no host hook is installed", () => {
    expect(shouldXtermHandleKey(event)).toBe(true);
  });
});

describe("shouldLoadWebglRenderer", () => {
  it("does not load WebGL on Windows even when a context is available", () => {
    expect(
      shouldLoadWebglRenderer({ hasWebglContext: true, platform: { desktopPlatform: "win32" } }),
    ).toBe(false);
    expect(
      shouldLoadWebglRenderer({
        hasWebglContext: true,
        platform: { navigatorPlatform: "Win32", userAgent: "Windows NT 10.0" },
      }),
    ).toBe(false);
  });

  it("loads WebGL off Windows when a context is available", () => {
    expect(
      shouldLoadWebglRenderer({ hasWebglContext: true, platform: { desktopPlatform: "darwin" } }),
    ).toBe(true);
    expect(
      shouldLoadWebglRenderer({ hasWebglContext: true, platform: { desktopPlatform: "linux" } }),
    ).toBe(true);
  });

  it("never loads WebGL without a context", () => {
    expect(
      shouldLoadWebglRenderer({ hasWebglContext: false, platform: { desktopPlatform: "darwin" } }),
    ).toBe(false);
  });
});

describe("XtermTerminalSurface", () => {
  it("builds an xterm theme with 16 ANSI colors and high contrast for dark mode", () => {
    const theme = buildXtermTheme({
      background: "#0a0a0a",
      foreground: "#f5f5f5",
      cursor: "#b4cbff",
      isDark: true,
    });
    expect(theme.background).toBe("#0a0a0a00");
    expect(theme.cursorAccent).toBe("#0a0a0a");
    expect(theme.foreground).toBe("#f5f5f5");
    expect(theme.black).toBe("#18181b");
    expect(theme.brightBlack).toBe("#434645");
    expect(theme.red).toBe("#e07070");
    expect(theme.brightRed).toBe("#e89090");
  });

  it("builds an xterm theme with 16 ANSI colors for light mode", () => {
    const theme = buildXtermTheme({
      background: "#ffffff",
      foreground: "#1a1a1e",
      cursor: "#26384e",
      isDark: false,
    });
    expect(theme.background).toBe("#ffffff00");
    expect(theme.cursorAccent).toBe("#ffffff");
    expect(theme.foreground).toBe("#1a1a1e");
    expect(theme.black).toBe("#1a1a1e");
    expect(theme.brightBlack).toBe("#71717a");
    expect(theme.red).toBe("#dc2626");
  });
});
