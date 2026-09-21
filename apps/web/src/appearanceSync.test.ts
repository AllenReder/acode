import { afterEach, describe, expect, it, vi } from "vite-plus/test";

vi.mock("./env", () => ({ isTauri: true }));

import { applyChatBackground, applyWindowGlass, isNativeGlassPlatform } from "./appearanceSync";

function makeRoot() {
  const classes = new Set<string>();
  const properties = new Map<string, string>();
  return {
    root: {
      classList: {
        add: (...names: string[]) => names.forEach((n) => classes.add(n)),
        remove: (...names: string[]) => names.forEach((n) => classes.delete(n)),
        toggle: (name: string, force?: boolean) => {
          const next = force ?? !classes.has(name);
          if (next) classes.add(name);
          else classes.delete(name);
          return next;
        },
        contains: (name: string) => classes.has(name),
      },
      style: {
        setProperty: (name: string, value: string) => properties.set(name, value),
        removeProperty: (name: string) => properties.delete(name),
        getPropertyValue: (name: string) => properties.get(name) ?? "",
      },
    } as unknown as HTMLElement,
    classes,
    properties,
  };
}

describe("appearanceSync", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  describe("isNativeGlassPlatform", () => {
    it("returns true on darwin desktop", () => {
      vi.stubGlobal("window", {
        desktopBridge: {
          getClientPlatform: () => "darwin",
        },
      });
      expect(isNativeGlassPlatform()).toBe(true);
    });
  });

  describe("applyWindowGlass", () => {
    it("applies opacity, blur, and workbench glass classes and styles", () => {
      const setWindowGlassEnabled = vi.fn().mockResolvedValue(undefined);
      const setWindowBackgroundBlur = vi.fn().mockResolvedValue(undefined);

      vi.stubGlobal("window", {
        desktopBridge: {
          getClientPlatform: () => "darwin",
          setWindowGlassEnabled,
          setWindowBackgroundBlur,
        },
      });

      const { root, properties, classes } = makeRoot();

      applyWindowGlass(
        {
          sidebarOpacity: 75,
          sidebarBlur: 30,
          workbenchGlass: true,
          workbenchOpacity: 90,
        },
        root,
      );

      expect(properties.get("--sidebar-opacity")).toBe("0.75");
      expect(properties.get("--sidebar-blur")).toBe("30px");
      expect(properties.get("--workbench-opacity")).toBe("0.9");
      expect(classes.has("has-native-glass")).toBe(true);
      expect(classes.has("glass-workbench")).toBe(true);

      expect(setWindowGlassEnabled).toHaveBeenCalledWith(true);
      expect(setWindowBackgroundBlur).toHaveBeenCalledWith(30);
    });

    it("removes glass-workbench class when workbenchGlass is false", () => {
      vi.stubGlobal("window", {
        desktopBridge: {
          getClientPlatform: () => "darwin",
          setWindowGlassEnabled: vi.fn(),
          setWindowBackgroundBlur: vi.fn(),
        },
      });

      const { root, classes } = makeRoot();
      classes.add("glass-workbench");

      applyWindowGlass(
        {
          sidebarOpacity: 85,
          sidebarBlur: 24,
          workbenchGlass: false,
          workbenchOpacity: 88,
        },
        root,
      );

      expect(classes.has("glass-workbench")).toBe(false);
    });
  });

  describe("applyChatBackground", () => {
    it("applies background image and opacity variables", () => {
      const { root, properties, classes } = makeRoot();

      applyChatBackground(
        {
          path: "/Users/test/wallpaper.png",
          opacity: 30,
          scope: "empty",
        },
        root,
      );

      expect(classes.has("has-chat-background")).toBe(true);
      expect(classes.has("chat-background-empty-only")).toBe(true);
      expect(properties.get("--chat-background-opacity")).toBe("0.3");
      expect(properties.get("--chat-background-image")).toBeDefined();
    });

    it("removes background classes and variables when path is null", () => {
      const { root, properties, classes } = makeRoot();
      classes.add("has-chat-background");
      classes.add("chat-background-empty-only");
      properties.set("--chat-background-image", "url(foo)");
      properties.set("--chat-background-opacity", "0.5");

      applyChatBackground(
        {
          path: null,
          opacity: 24,
          scope: "all",
        },
        root,
      );

      expect(classes.has("has-chat-background")).toBe(false);
      expect(classes.has("chat-background-empty-only")).toBe(false);
      expect(properties.has("--chat-background-image")).toBe(false);
      expect(properties.has("--chat-background-opacity")).toBe(false);
    });
  });
});
