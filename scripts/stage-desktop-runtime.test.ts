// @effect-diagnostics nodeBuiltinImport:off
import { describe, expect, it } from "vite-plus/test";

import {
  readNodeShasum,
  readStageArguments,
  resolveDesktopRuntimeTarget,
  resolveRuntimeNodeVersion,
  runtimeNodeDownload,
} from "./stage-desktop-runtime.ts";

const WIN_EXE_SHA = "e3be0545990c90995d7bf3a7af5d64af1f2e0fc1bbd9b79c27f7abc1e9676e50";
const DARWIN_ARM64_SHA = "8c039d59f2fec6195e4281ad5b0d02b9a940897b4df7b849c6fb48be6787bba6";
const PUBLISHED_SHASUMS = [
  `${DARWIN_ARM64_SHA}  node-v24.13.1-darwin-arm64.tar.gz`,
  "527f0578d9812e7dfa225121bda0b1546a6a0e4b5f556295fc8299c272de5fbf  node-v24.13.1-darwin-x64.tar.gz",
  `${WIN_EXE_SHA}  win-x64/node.exe`,
  "",
].join("\n");

describe("desktop runtime targets", () => {
  it("maps the triples the release builds", () => {
    expect(resolveDesktopRuntimeTarget("aarch64-apple-darwin")).toEqual({
      triple: "aarch64-apple-darwin",
      platform: "darwin",
      arch: "arm64",
      nodeName: "node",
    });
    expect(resolveDesktopRuntimeTarget("x86_64-apple-darwin").arch).toBe("x64");
    expect(resolveDesktopRuntimeTarget("x86_64-pc-windows-msvc").nodeName).toBe("node.exe");
    expect(resolveDesktopRuntimeTarget("x86_64-unknown-linux-gnu").platform).toBe("linux");
  });

  it("refuses a triple it cannot stage a runtime for", () => {
    expect(() => resolveDesktopRuntimeTarget("x86_64-unknown-freebsd")).toThrow(
      /Unsupported desktop runtime target/u,
    );
  });
});

describe("embedded Node version", () => {
  it("reads the exact version and the caret range the manifest uses", () => {
    expect(resolveRuntimeNodeVersion("24.13.1")).toBe("24.13.1");
    expect(resolveRuntimeNodeVersion("^24.13.1")).toBe("24.13.1");
  });

  it("refuses a range that cannot be downloaded as one version", () => {
    expect(() => resolveRuntimeNodeVersion(">=24")).toThrow(/exact engines.node version/u);
    expect(() => resolveRuntimeNodeVersion(undefined)).toThrow(/exact engines.node version/u);
  });
});

describe("runtime Node downloads", () => {
  it("takes the Windows executable straight from the dist directory", () => {
    const download = runtimeNodeDownload(
      "24.13.1",
      resolveDesktopRuntimeTarget("x86_64-pc-windows-msvc"),
    );
    expect(download.url).toBe("https://nodejs.org/dist/v24.13.1/win-x64/node.exe");
    expect(download.checksumName).toBe("win-x64/node.exe");
    expect(download.archive).toBe(false);
  });

  it("unpacks the macOS and Linux tarballs", () => {
    const download = runtimeNodeDownload(
      "24.13.1",
      resolveDesktopRuntimeTarget("x86_64-apple-darwin"),
    );
    expect(download.url).toBe("https://nodejs.org/dist/v24.13.1/node-v24.13.1-darwin-x64.tar.gz");
    expect(download.checksumName).toBe("node-v24.13.1-darwin-x64.tar.gz");
    expect(download.archive).toBe(true);
    expect(download.entryPath).toBe("node-v24.13.1-darwin-x64/bin/node");
  });
});

describe("published checksums", () => {
  it("finds the digest the download is verified against", () => {
    expect(readNodeShasum(PUBLISHED_SHASUMS, "win-x64/node.exe")).toBe(WIN_EXE_SHA);
    expect(readNodeShasum(PUBLISHED_SHASUMS, "node-v24.13.1-darwin-arm64.tar.gz")).toBe(
      DARWIN_ARM64_SHA,
    );
  });

  it("fails when the file has no published digest", () => {
    expect(() => readNodeShasum(PUBLISHED_SHASUMS, "node-v24.13.1-win-x64.zip")).toThrow(
      /No SHA256 entry/u,
    );
  });
});

describe("stage arguments", () => {
  it("reads both spellings of --target and defaults to the host runtime", () => {
    expect(readStageArguments([])).toEqual({});
    expect(readStageArguments(["--target", "x86_64-apple-darwin"])).toEqual({
      target: "x86_64-apple-darwin",
    });
    expect(readStageArguments(["--target=aarch64-apple-darwin"])).toEqual({
      target: "aarch64-apple-darwin",
    });
  });

  it("rejects an unknown argument or a missing triple", () => {
    expect(() => readStageArguments(["--bundle"])).toThrow(/Unknown argument/u);
    expect(() => readStageArguments(["--target"])).toThrow(/needs a Rust target triple/u);
    expect(() => readStageArguments(["--target="])).toThrow(/needs a Rust target triple/u);
  });
});
