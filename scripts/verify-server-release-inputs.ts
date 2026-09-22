#!/usr/bin/env node
// @effect-diagnostics globalConsole:off
import { isExactServerPackageVersion } from "./build-server-package.ts";

const [version, tag] = process.argv.slice(2);

if (!isExactServerPackageVersion(version ?? "")) {
  console.error("Version must be an exact semver-like value, not latest or a dist-tag.");
  process.exit(1);
}

const reservedAliases = new Set(["latest", "nightly", "preview"]);

if (reservedAliases.has((tag ?? "").toLowerCase())) {
  console.error("The server release workflow must not publish a shared channel alias.");
  process.exit(1);
}
