#!/usr/bin/env node
// @effect-diagnostics globalConsole:off
import packageJson from "../apps/server/package.json" with { type: "json" };
import productPackageJson from "../package.json" with { type: "json" };

const isExactServerPackageVersion = (version: string): boolean => {
  const core = "(?:0|[1-9]\\d*)";
  const prerelease = "(?:0|[1-9]\\d*|\\d*[A-Za-z-][0-9A-Za-z-]*)";
  return new RegExp(
    `^${core}\\.${core}\\.${core}(?:-${prerelease}(?:\\.${prerelease})*)?$`,
    "u",
  ).test(version);
};

export interface VerifyServerReleaseInputs {
  readonly version: string;
  readonly tag?: string | undefined;
  readonly productVersion: string;
  readonly serverVersion: string;
}

export function verifyServerReleaseInputs(input: VerifyServerReleaseInputs): string[] {
  const problems: string[] = [];

  if (!isExactServerPackageVersion(input.version)) {
    problems.push("Version must be an exact semver-like value, not latest or a dist-tag.");
  }
  if (input.version !== input.productVersion) {
    problems.push(
      `Version ${input.version} does not match the product version ${input.productVersion}.`,
    );
  }
  if (input.version !== input.serverVersion) {
    problems.push(
      `Version ${input.version} does not match the checked-out daemon version ${input.serverVersion}.`,
    );
  }

  const reservedAliases = new Set(["latest", "nightly", "preview"]);
  if (reservedAliases.has((input.tag ?? "").toLowerCase())) {
    problems.push("The server release workflow must not publish a shared channel alias.");
  }
  if (input.tag && input.tag !== `v${input.version}`) {
    problems.push(`SSH installation requires the release tag v${input.version}.`);
  }

  return problems;
}

if (import.meta.main) {
  const [version = "", tag] = process.argv.slice(2);
  const problems = verifyServerReleaseInputs({
    version,
    tag,
    productVersion: productPackageJson.version,
    serverVersion: packageJson.version,
  });
  if (problems.length > 0) {
    process.stderr.write(`${problems.join("\n")}\n`);
    process.exitCode = 1;
  }
}
