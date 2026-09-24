#!/usr/bin/env node
// @effect-diagnostics nodeBuiltinImport:off

import * as NodeFS from "node:fs";
import * as NodePath from "node:path";

const REPO_ROOT = NodePath.resolve(import.meta.dirname, "..");
const SEMVER_CORE = "(?:0|[1-9]\\d*)";
const SEMVER_PRERELEASE_IDENTIFIER = "(?:0|[1-9]\\d*|\\d*[A-Za-z-][0-9A-Za-z-]*)";
const EXACT_VERSION = new RegExp(
  `^${SEMVER_CORE}\\.${SEMVER_CORE}\\.${SEMVER_CORE}(?:-${SEMVER_PRERELEASE_IDENTIFIER}(?:\\.${SEMVER_PRERELEASE_IDENTIFIER})*)?$`,
  "u",
);
const PACKAGE_FILES = [
  "package.json",
  "apps/server/package.json",
  "apps/web/package.json",
  "apps/desktop/package.json",
  "packages/contracts/package.json",
] as const;
const TAURI_CONFIG = "apps/desktop/src-tauri/tauri.conf.json";
const TAURI_MACOS_CONFIG = "apps/desktop/src-tauri/tauri.macos.conf.json";
const TAURI_VERSION_SOURCE = "../../../package.json";
const CARGO_MANIFEST = "apps/desktop/src-tauri/Cargo.toml";
const CARGO_LOCK = "apps/desktop/src-tauri/Cargo.lock";

function readJson(filePath: string): Record<string, unknown> {
  const value: unknown = JSON.parse(NodeFS.readFileSync(filePath, "utf8"));
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${filePath} must contain a JSON object.`);
  }
  return value as Record<string, unknown>;
}

function formatJson(value: Record<string, unknown>): string {
  return `${JSON.stringify(value, null, 2)}\n`;
}

export function macOSNativeVersion(version: string): string {
  if (!EXACT_VERSION.test(version)) {
    throw new Error(`Version must be an exact semver-like value, received '${version}'.`);
  }
  return version.split("-", 1)[0]!;
}

function isNumericBundleVersion(version: unknown): boolean {
  if (typeof version !== "string" || !/^\d+$/u.test(version)) return false;
  return Number.isSafeInteger(Number(version));
}

function incrementMacOSBundleVersion(version: unknown): string {
  if (typeof version !== "string" || !/^\d+$/u.test(version)) {
    throw new Error("macOS bundleVersion must be a numeric build number.");
  }
  const buildNumber = Number(version);
  if (!Number.isSafeInteger(buildNumber)) {
    throw new Error("macOS bundleVersion must be a safe integer.");
  }
  return String(buildNumber + 1);
}

function cargoVersion(contents: string, heading: string): string {
  const section = contents.split(heading)[1]?.split(/\n\[/u)[0];
  const version = /^version = "([^"]+)"$/mu.exec(section ?? "")?.[1];
  if (!version) throw new Error(`Could not find ${heading} version.`);
  return version;
}

function updateCargoVersion(contents: string, heading: string, version: string): string {
  const current = cargoVersion(contents, heading);
  const sectionStart = contents.indexOf(heading) + heading.length;
  const versionStart = contents.indexOf(`version = "${current}"`, sectionStart);
  return `${contents.slice(0, versionStart)}version = "${version}"${contents.slice(versionStart + `version = "${current}"`.length)}`;
}

export function checkVersion(rootDir = REPO_ROOT): string[] {
  const rootVersion = readJson(NodePath.join(rootDir, "package.json")).version;
  if (typeof rootVersion !== "string" || !EXACT_VERSION.test(rootVersion)) {
    return ["package.json must declare an exact product version."];
  }

  const problems: string[] = [];
  for (const relativePath of PACKAGE_FILES.slice(1)) {
    const version = readJson(NodePath.join(rootDir, relativePath)).version;
    if (version !== rootVersion) {
      problems.push(`${relativePath}: expected ${rootVersion}, found ${String(version)}.`);
    }
  }
  const tauriVersion = readJson(NodePath.join(rootDir, TAURI_CONFIG)).version;
  if (tauriVersion !== TAURI_VERSION_SOURCE) {
    problems.push(`${TAURI_CONFIG}: expected ${TAURI_VERSION_SOURCE}.`);
  }
  const macosConfig = readJson(NodePath.join(rootDir, TAURI_MACOS_CONFIG));
  const expectedMacOSVersion = macOSNativeVersion(rootVersion);
  if (macosConfig.version !== expectedMacOSVersion) {
    problems.push(
      `${TAURI_MACOS_CONFIG}: expected ${expectedMacOSVersion}, found ${String(macosConfig.version)}.`,
    );
  }
  const macOSBundleVersion = (
    (macosConfig.bundle as Record<string, unknown> | undefined)?.macOS as
      | Record<string, unknown>
      | undefined
  )?.bundleVersion;
  if (!isNumericBundleVersion(macOSBundleVersion)) {
    problems.push(`${TAURI_MACOS_CONFIG}: bundle.macOS.bundleVersion must be numeric.`);
  }
  for (const [relativePath, heading] of [
    [CARGO_MANIFEST, '[package]\nname = "awen-desktop"'],
    [CARGO_LOCK, '[[package]]\nname = "awen-desktop"'],
  ] as const) {
    const version = cargoVersion(
      NodeFS.readFileSync(NodePath.join(rootDir, relativePath), "utf8"),
      heading,
    );
    if (version !== rootVersion) {
      problems.push(`${relativePath}: expected ${rootVersion}, found ${version}.`);
    }
  }
  return problems;
}

export function setVersion(version: string, rootDir = REPO_ROOT): void {
  if (!EXACT_VERSION.test(version)) {
    throw new Error(`Version must be an exact semver-like value, received '${version}'.`);
  }

  const updates = new Map<string, string>();
  for (const relativePath of PACKAGE_FILES) {
    const packageJson = readJson(NodePath.join(rootDir, relativePath));
    if (typeof packageJson.version !== "string") {
      throw new Error(`${relativePath} must already declare a version.`);
    }
    packageJson.version = version;
    updates.set(relativePath, formatJson(packageJson));
  }
  const tauriConfig = readJson(NodePath.join(rootDir, TAURI_CONFIG));
  tauriConfig.version = TAURI_VERSION_SOURCE;
  updates.set(TAURI_CONFIG, formatJson(tauriConfig));
  const currentProductVersion = readJson(NodePath.join(rootDir, "package.json")).version;
  const macosConfig = readJson(NodePath.join(rootDir, TAURI_MACOS_CONFIG));
  macosConfig.version = macOSNativeVersion(version);
  const macOSBundle = macosConfig.bundle as Record<string, unknown> | undefined;
  const macOSConfigBundle = (macOSBundle?.macOS as Record<string, unknown> | undefined) ?? {};
  if (version !== currentProductVersion) {
    macOSConfigBundle.bundleVersion = incrementMacOSBundleVersion(macOSConfigBundle.bundleVersion);
  }
  macosConfig.bundle = { ...macOSBundle, macOS: macOSConfigBundle };
  updates.set(TAURI_MACOS_CONFIG, formatJson(macosConfig));
  for (const [relativePath, heading] of [
    [CARGO_MANIFEST, '[package]\nname = "awen-desktop"'],
    [CARGO_LOCK, '[[package]]\nname = "awen-desktop"'],
  ] as const) {
    updates.set(
      relativePath,
      updateCargoVersion(
        NodeFS.readFileSync(NodePath.join(rootDir, relativePath), "utf8"),
        heading,
        version,
      ),
    );
  }

  for (const [relativePath, contents] of updates) {
    const filePath = NodePath.join(rootDir, relativePath);
    if (NodeFS.readFileSync(filePath, "utf8") !== contents)
      NodeFS.writeFileSync(filePath, contents);
  }
}

if (import.meta.main) {
  try {
    const [command, version] = process.argv.slice(2);
    if (command === "check") {
      const problems = checkVersion();
      if (problems.length > 0) throw new Error(problems.join("\n"));
      process.stdout.write("Product versions are in sync.\n");
    } else if (command === "set" && version) {
      setVersion(version);
      process.stdout.write(`Product version set to ${version}.\n`);
    } else {
      throw new Error("Usage: node scripts/version.ts check | set <version>");
    }
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  }
}
