#!/usr/bin/env node
// @effect-diagnostics globalConsole:off
import { isExactServerPackageVersion } from "./build-server-package.ts";
import packageJson from "../apps/server/package.json" with { type: "json" };
import productPackageJson from "../package.json" with { type: "json" };

const [version, tag] = process.argv.slice(2);

if (!isExactServerPackageVersion(version ?? "")) {
  console.error("Version must be an exact semver-like value, not latest or a dist-tag.");
  process.exit(1);
}

if (version !== productPackageJson.version) {
  console.error(
    `Version ${version} does not match the product version ${productPackageJson.version}.`,
  );
  process.exit(1);
}

if (version !== packageJson.version) {
  console.error(
    `Version ${version} does not match the checked-out daemon version ${packageJson.version}.`,
  );
  process.exit(1);
}

const reservedAliases = new Set(["latest", "nightly", "preview"]);

if (reservedAliases.has((tag ?? "").toLowerCase())) {
  console.error("The server release workflow must not publish a shared channel alias.");
  process.exit(1);
}
if (tag && tag !== `v${version}`) {
  console.error(`SSH installation requires the release tag v${version}.`);
  process.exit(1);
}
