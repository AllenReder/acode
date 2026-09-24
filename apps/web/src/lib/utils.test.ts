import { describe, assert, it } from "vite-plus/test";
import {
  getLocalFileManagerName,
  isLinuxPlatform,
  isWindowsPlatform,
  usesCustomWindowChrome,
} from "./utils";

describe("getLocalFileManagerName", () => {
  it.each([
    ["MacIntel", "Finder"],
    ["Win32", "File Explorer"],
    ["Linux", "Files"],
  ])("uses the %s file manager name", (platform, expected) => {
    assert.strictEqual(getLocalFileManagerName(platform), expected);
  });
});

describe("isWindowsPlatform", () => {
  it("matches Windows platform identifiers", () => {
    assert.isTrue(isWindowsPlatform("Win32"));
    assert.isTrue(isWindowsPlatform("Windows"));
    assert.isTrue(isWindowsPlatform("windows_nt"));
  });

  it("does not match darwin", () => {
    assert.isFalse(isWindowsPlatform("darwin"));
  });
});

describe("isLinuxPlatform", () => {
  it("matches Linux platform identifiers", () => {
    assert.isTrue(isLinuxPlatform("Linux"));
    assert.isTrue(isLinuxPlatform("Linux x86_64"));
    assert.isTrue(isLinuxPlatform("linux"));
  });

  it("does not match macOS or Windows", () => {
    assert.isFalse(isLinuxPlatform("MacIntel"));
    assert.isFalse(isLinuxPlatform("Win32"));
  });
});

describe("usesCustomWindowChrome", () => {
  it("matches the desktop platforms with Awen-rendered window controls", () => {
    assert.isTrue(usesCustomWindowChrome("Win32"));
    assert.isTrue(usesCustomWindowChrome("Linux x86_64"));
  });

  it("does not match macOS", () => {
    assert.isFalse(usesCustomWindowChrome("MacIntel"));
  });
});
