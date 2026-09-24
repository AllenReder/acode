import { describe, expect, it } from "vite-plus/test";

import {
  cliArchiveFileName,
  cliArchivePlatformKey,
  cliArchiveTarCommand,
  cliReleaseDownloadBaseUrl,
  cliReleaseChannelOf,
  cliReleaseIndexPageUrl,
  newestCliReleaseVersion,
  parseChecksums,
} from "./cliRelease.ts";

describe("daemonRelease", () => {
  it("uses the Linux x64 daemon artifact name for stable and prerelease versions", () => {
    expect(cliArchiveFileName("0.1.0-alpha.1", "linux-x64")).toBe(
      "awen-server-0.1.0-alpha.1-linux-x64.tar.gz",
    );
    expect(cliArchiveFileName("0.1.0", "linux-x64")).toBe("awen-server-0.1.0-linux-x64.tar.gz");
  });

  it("offers automatic daemon packages for Linux x64 only", () => {
    expect(cliArchivePlatformKey("linux", "x64")).toBe("linux-x64");
    expect(cliArchivePlatformKey("darwin", "arm64")).toBeUndefined();
    expect(cliArchivePlatformKey("win32", "x64")).toBeUndefined();
    expect(cliArchiveTarCommand("linux", {})).toBe("tar");
  });

  it("resolves release asset URLs under the tagged release", () => {
    expect(cliReleaseDownloadBaseUrl("0.1.0-alpha.1")).toBe(
      "https://github.com/AllenReder/awen/releases/download/v0.1.0-alpha.1",
    );
    expect(cliReleaseDownloadBaseUrl("0.1.0", "https://mirror.example/awen/")).toBe(
      "https://mirror.example/awen/v0.1.0",
    );
  });

  it("parses sha256sum output including binary-mode markers", () => {
    const checksums = parseChecksums(
      [
        `${"a".repeat(64)}  awen-server-0.1.0-linux-x64.tar.gz`,
        `${"B".repeat(64)} *Awen-0.1.0-windows-x64.exe`,
        "not a checksum line",
        "",
      ].join("\n"),
    );
    expect(checksums.get("awen-server-0.1.0-linux-x64.tar.gz")).toBe("a".repeat(64));
    expect(checksums.get("Awen-0.1.0-windows-x64.exe")).toBe("b".repeat(64));
    expect(checksums.size).toBe(2);
  });

  it("separates stable tags from prerelease tags", () => {
    expect(cliReleaseChannelOf("0.1.0")).toBe("stable");
    expect(cliReleaseChannelOf("0.1.0-alpha.1")).toBe("prerelease");
    const releases = [
      { tag_name: "v0.2.0-alpha.2", draft: true },
      { tag_name: "v0.2.0-alpha.1", prerelease: true },
      { tag_name: "v0.2.0-alpha.01", prerelease: true },
      { tag_name: "v0.1.0" },
      { tag_name: "desktop-preview" },
    ];
    expect(newestCliReleaseVersion(releases, "prerelease")).toBe("0.2.0-alpha.1");
    expect(newestCliReleaseVersion(releases, "stable")).toBe("0.1.0");
    expect(cliReleaseIndexPageUrl(1)).toBe(
      "https://api.github.com/repos/AllenReder/awen/releases?per_page=100&page=1",
    );
  });
});
