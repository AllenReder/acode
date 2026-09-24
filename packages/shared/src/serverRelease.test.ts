import { describe, expect, it } from "vite-plus/test";

import { serverReleaseArchiveName, serverReleaseDownloadBaseUrl } from "./serverRelease.ts";

describe("serverRelease", () => {
  it("names the Linux x64 daemon archive for an exact version", () => {
    expect(serverReleaseArchiveName("0.0.42")).toBe("awen-server-0.0.42-linux-x64.tar.gz");
    expect(serverReleaseArchiveName("0.0.43-rc.1")).toBe(
      "awen-server-0.0.43-rc.1-linux-x64.tar.gz",
    );
  });

  it("resolves exact-version download URLs", () => {
    expect(serverReleaseDownloadBaseUrl("0.0.42")).toBe(
      "https://github.com/AllenReder/awen/releases/download/v0.0.42",
    );
    expect(serverReleaseDownloadBaseUrl("0.0.42", "https://mirror.example/awen/")).toBe(
      "https://mirror.example/awen/v0.0.42",
    );
  });
});
