// @effect-diagnostics nodeBuiltinImport:off
import * as NodeFS from "node:fs";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";
import { describe, expect, it } from "vite-plus/test";

import { checkVersion, setVersion } from "./version.ts";

const REPO_ROOT = NodePath.resolve(import.meta.dirname, "..");
const VERSIONED_FILES = [
  "package.json",
  "apps/server/package.json",
  "apps/web/package.json",
  "apps/desktop/package.json",
  "packages/contracts/package.json",
  "apps/desktop/src-tauri/tauri.conf.json",
  "apps/desktop/src-tauri/tauri.macos.conf.json",
  "apps/desktop/src-tauri/Cargo.toml",
  "apps/desktop/src-tauri/Cargo.lock",
];

function withVersionFixture(run: (rootDir: string) => void): void {
  const rootDir = NodeFS.mkdtempSync(NodePath.join(NodeOS.tmpdir(), "awen-version-"));
  try {
    for (const relativePath of VERSIONED_FILES) {
      const target = NodePath.join(rootDir, relativePath);
      NodeFS.mkdirSync(NodePath.dirname(target), { recursive: true });
      NodeFS.copyFileSync(NodePath.join(REPO_ROOT, relativePath), target);
    }
    run(rootDir);
  } finally {
    NodeFS.rmSync(rootDir, { recursive: true, force: true });
  }
}

describe("product version", () => {
  it("keeps the checked-in manifests aligned", () => {
    expect(checkVersion()).toEqual([]);
  });

  it("updates every product manifest from one version", () => {
    withVersionFixture((rootDir) => {
      const macosConfigPath = NodePath.join(
        rootDir,
        "apps/desktop/src-tauri/tauri.macos.conf.json",
      );
      const initialMacosConfig = JSON.parse(NodeFS.readFileSync(macosConfigPath, "utf8")) as {
        bundle: { macOS: { bundleVersion: string } };
      };
      const nextBundleVersion = String(Number(initialMacosConfig.bundle.macOS.bundleVersion) + 1);
      setVersion("1.2.3-rc.1", rootDir);

      expect(checkVersion(rootDir)).toEqual([]);
      expect(
        JSON.parse(NodeFS.readFileSync(NodePath.join(rootDir, "package.json"), "utf8")).version,
      ).toBe("1.2.3-rc.1");
      expect(
        NodeFS.readFileSync(NodePath.join(rootDir, "apps/desktop/src-tauri/Cargo.toml"), "utf8"),
      ).toContain('version = "1.2.3-rc.1"');
      expect(
        NodeFS.readFileSync(
          NodePath.join(rootDir, "apps/desktop/src-tauri/tauri.conf.json"),
          "utf8",
        ),
      ).toContain('"version": "../../../package.json"');
      const macosConfig = JSON.parse(NodeFS.readFileSync(macosConfigPath, "utf8")) as {
        version: string;
        bundle: { macOS: { bundleVersion: string } };
      };
      expect(macosConfig.version).toBe("1.2.3");
      expect(macosConfig.bundle.macOS.bundleVersion).toBe(nextBundleVersion);

      setVersion("1.2.3-rc.1", rootDir);
      const repeatedMacosConfig = JSON.parse(NodeFS.readFileSync(macosConfigPath, "utf8")) as {
        bundle: { macOS: { bundleVersion: string } };
      };
      expect(repeatedMacosConfig.bundle.macOS.bundleVersion).toBe(nextBundleVersion);
    });
  });

  // `formatJson` expands compact arrays. Rewriting an unchanged manifest turned
  // that into formatting churn that failed `vp fmt --check` in CI.
  it("leaves a manifest whose value did not change byte-for-byte intact", () => {
    withVersionFixture((rootDir) => {
      const tauriConfigPath = NodePath.join(rootDir, "apps/desktop/src-tauri/tauri.conf.json");
      const original = NodeFS.readFileSync(tauriConfigPath, "utf8");
      expect(original).toContain('"scope": ["$RESOURCE/**"]');

      setVersion("1.2.3-rc.1", rootDir);

      expect(NodeFS.readFileSync(tauriConfigPath, "utf8")).toBe(original);
    });
  });

  it("reports drift and rejects an invalid version before editing", () => {
    withVersionFixture((rootDir) => {
      const webPackagePath = NodePath.join(rootDir, "apps/web/package.json");
      const original = NodeFS.readFileSync(webPackagePath, "utf8");
      const currentVersion = JSON.parse(original).version as string;
      expect(() => setVersion("latest", rootDir)).toThrow(/exact semver-like/u);
      expect(() => setVersion("0.1.0-alpha.01", rootDir)).toThrow(/exact semver-like/u);
      expect(NodeFS.readFileSync(webPackagePath, "utf8")).toBe(original);

      NodeFS.writeFileSync(
        webPackagePath,
        original.replace(`"version": "${currentVersion}"`, '"version": "9.9.9"'),
      );
      expect(checkVersion(rootDir)).toContain(
        `apps/web/package.json: expected ${currentVersion}, found 9.9.9.`,
      );
    });
  });
});
