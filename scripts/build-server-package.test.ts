import * as NodeCrypto from "node:crypto";
// @effect-diagnostics nodeBuiltinImport:off
import * as NodeFS from "node:fs";
// @effect-diagnostics nodeBuiltinImport:off
import * as NodeOS from "node:os";
// @effect-diagnostics nodeBuiltinImport:off
import * as NodePath from "node:path";
import { describe, expect, it } from "vite-plus/test";

import { buildServerPackage, isExactServerPackageVersion } from "./build-server-package.ts";

describe("buildServerPackage", () => {
  it("accepts only exact server package versions", () => {
    expect(isExactServerPackageVersion("0.0.42")).toBe(true);
    expect(isExactServerPackageVersion("0.0.42-rc.1")).toBe(true);
    expect(isExactServerPackageVersion("0.0.42+build")).toBe(false);
    expect(isExactServerPackageVersion("latest")).toBe(false);
    expect(isExactServerPackageVersion("v0.0.42")).toBe(false);
    expect(isExactServerPackageVersion("")).toBe(false);
  });

  it("rejects a release version that differs from the packaged daemon", () => {
    expect(() => buildServerPackage({ version: "0.0.43-rc.1", skipBuild: true })).toThrow(
      /does not match the bundled daemon version/u,
    );
  });

  it("uses the bundled version for the archive name and checksum", async () => {
    const outputDir = NodeFS.mkdtempSync(NodePath.join(NodeOS.tmpdir(), "acode-server-package-"));
    try {
      const result = await buildServerPackage({
        outputDir,
        platform: "linux",
        arch: "x64",
        version: "0.0.42",
        skipBuild: true,
      });

      expect(NodePath.basename(result.archivePath)).toBe("acode-server-0.0.42-linux-x64.tar.gz");
      expect(NodeFS.readFileSync(result.checksumPath, "utf8")).toMatch(
        /^[0-9a-f]{64}  acode-server-0\.0\.42-linux-x64\.tar\.gz\n$/u,
      );
    } finally {
      NodeFS.rmSync(outputDir, { recursive: true, force: true });
    }
  });

  it("writes a SHA256SUMS file for the final archive bytes", async () => {
    const outputDir = NodeFS.mkdtempSync(NodePath.join(NodeOS.tmpdir(), "acode-server-package-"));
    try {
      const result = await buildServerPackage({
        outputDir,
        platform: "linux",
        arch: "x64",
        skipBuild: true,
      });

      const expectedHash = NodeCrypto.createHash("sha256")
        .update(NodeFS.readFileSync(result.archivePath))
        .digest("hex");
      const checksumContents = NodeFS.readFileSync(result.checksumPath, "utf8");

      expect(checksumContents).toBe(`${expectedHash}  acode-server-0.0.42-linux-x64.tar.gz\n`);
      expect(NodePath.basename(result.checksumPath)).toBe("SHA256SUMS");
    } finally {
      NodeFS.rmSync(outputDir, { recursive: true, force: true });
    }
  });
});
