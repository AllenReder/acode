#!/usr/bin/env node
// @effect-diagnostics nodeBuiltinImport:off globalConsole:off
/**
 * Assembles a standalone headless server distribution package for ACode daemon.
 * Layout:
 *   bin/acode (executable launcher with Node.js version verification)
 *   bin/t3 (symlink to acode)
 *   dist/bin.mjs
 *   package.json
 *   node_modules/ (production dependencies)
 */
import * as NodeChildProcess from "node:child_process";
import * as NodeCrypto from "node:crypto";
import * as NodeFS from "node:fs";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";
import { HostProcessArchitecture, HostProcessPlatform } from "@t3tools/shared/hostProcess";
import * as Effect from "effect/Effect";
import packageJson from "../apps/server/package.json" with { type: "json" };
import productPackageJson from "../package.json" with { type: "json" };

const REPO_ROOT = NodePath.resolve(import.meta.dirname, "..");
const DEFAULT_OUTPUT_DIR = NodePath.join(REPO_ROOT, "release-server");

const WRAPPER_SCRIPT = `#!/bin/sh
set -eu
SCRIPT_DIR="$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)"
SERVER_DIR="$(CDPATH= cd -- "$SCRIPT_DIR/.." && pwd)"

if ! command -v node >/dev/null 2>&1; then
  echo "Error: Node.js ^22.16, ^23.11, or >=24.10 is required to run ACode daemon." >&2
  echo "Please install Node.js (https://nodejs.org) on this system." >&2
  exit 1
fi

if ! node -e 'const [major, minor] = process.versions.node.split(".").map(Number); process.exit((major === 22 && minor >= 16) || (major === 23 && minor >= 11) || (major === 24 && minor >= 10) || major > 24 ? 0 : 1)' >/dev/null 2>&1; then
  echo "Error: Node.js ^22.16, ^23.11, or >=24.10 is required (found $(node -v))." >&2
  exit 1
fi

export ACODE_HOME="\${ACODE_HOME:-$HOME/.acode}"
export T3CODE_HOME="\${T3CODE_HOME:-$ACODE_HOME}"

exec node "$SERVER_DIR/dist/bin.mjs" "$@"
`;

export interface BuildServerPackageOptions {
  readonly outputDir?: string | undefined;
  readonly platform?: string;
  readonly arch?: string;
  readonly version?: string;
  readonly skipBuild?: boolean;
}

export function isExactServerPackageVersion(version: string): boolean {
  return /^(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)(?:-[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/u.test(
    version,
  );
}

export function buildServerPackage(options: BuildServerPackageOptions = {}) {
  const hostPlatform = Effect.runSync(HostProcessPlatform);
  const hostArch = Effect.runSync(HostProcessArchitecture);
  const outputDir = options.outputDir ?? DEFAULT_OUTPUT_DIR;
  const platform =
    options.platform ??
    (hostPlatform === "darwin" ? "darwin" : hostPlatform === "win32" ? "win32" : "linux");
  const arch = options.arch ?? (hostArch === "arm64" ? "arm64" : "x64");
  const version = options.version ?? productPackageJson.version;
  if (!isExactServerPackageVersion(version)) {
    throw new Error(`Server package version must be exact, received '${version}'.`);
  }
  if (version !== productPackageJson.version) {
    throw new Error(
      `Server package version ${version} does not match the product version ${productPackageJson.version}.`,
    );
  }
  if (version !== packageJson.version) {
    throw new Error(
      `Server package version ${version} does not match the bundled daemon version ${packageJson.version}.`,
    );
  }
  const stem = `acode-server-${version}-${platform}-${arch}`;

  if (!options.skipBuild) {
    console.log("[build-server-package] Building server bundle in apps/server...");
    NodeChildProcess.execSync("pnpm exec vp pack", {
      cwd: NodePath.join(REPO_ROOT, "apps/server"),
      stdio: "inherit",
    });
  }

  const stageRoot = NodeFS.mkdtempSync(NodePath.join(NodeOS.tmpdir(), "acode-server-pkg-"));
  const stageDir = NodePath.join(stageRoot, stem);

  try {
    console.log(`[build-server-package] Staging production deployment into ${stageDir}...`);
    NodeChildProcess.execSync(
      `pnpm --config.confirmModulesPurge=false --filter=t3 deploy --legacy --prod "${stageDir}"`,
      {
        cwd: REPO_ROOT,
        stdio: "inherit",
      },
    );

    const binDir = NodePath.join(stageDir, "bin");
    NodeFS.mkdirSync(binDir, { recursive: true });

    const acodeWrapperPath = NodePath.join(binDir, "acode");
    NodeFS.writeFileSync(acodeWrapperPath, WRAPPER_SCRIPT, { mode: 0o755 });

    const t3WrapperPath = NodePath.join(binDir, "t3");
    try {
      NodeFS.symlinkSync("acode", t3WrapperPath);
    } catch {
      NodeFS.writeFileSync(t3WrapperPath, WRAPPER_SCRIPT, { mode: 0o755 });
    }

    const readmeContent = `# ACode Daemon Package

Standalone headless server package for ACode daemon.

## Requirements
- Linux x64 (or supported POSIX environment)
- Node.js >= 22.16
- Git

## Quick Start

\`\`\`bash
# Start daemon in background (survives SSH disconnect)
./bin/acode daemon start

# Check status
./bin/acode daemon status

# Generate client pairing token for ACode desktop
./bin/acode auth pairing create --json

# Read bootstrap token
./bin/acode daemon token

# Stop daemon safely
./bin/acode daemon stop --confirm
\`\`\`
`;
    NodeFS.writeFileSync(NodePath.join(stageDir, "README.md"), readmeContent);

    NodeFS.mkdirSync(outputDir, { recursive: true });
    const archiveFileName = `${stem}.tar.gz`;
    const archivePath = NodePath.join(outputDir, archiveFileName);
    const checksumPath = NodePath.join(outputDir, "SHA256SUMS");

    console.log(`[build-server-package] Creating archive ${archivePath}...`);
    NodeChildProcess.execSync(`tar -czf "${archivePath}" -C "${stageRoot}" "${stem}"`, {
      stdio: "inherit",
    });
    const archiveHash = NodeCrypto.createHash("sha256")
      .update(NodeFS.readFileSync(archivePath))
      .digest("hex");
    NodeFS.writeFileSync(checksumPath, `${archiveHash}  ${archiveFileName}\n`);

    console.log(`[build-server-package] Successfully created ${archivePath}`);
    console.log(`[build-server-package] Wrote ${checksumPath}`);
    return { archivePath, checksumPath, stageDir, stem, version };
  } finally {
    NodeFS.rmSync(stageRoot, { recursive: true, force: true });
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const args = process.argv.slice(2);
  const optionValue = (name: string) => {
    const index = args.indexOf(`--${name}`);
    return index !== -1 ? args[index + 1] : undefined;
  };
  const outputDir = optionValue("output-dir");
  const platform = optionValue("platform");
  const arch = optionValue("arch");
  const version = optionValue("version");
  buildServerPackage({
    ...(outputDir !== undefined ? { outputDir } : {}),
    ...(platform !== undefined ? { platform } : {}),
    ...(arch !== undefined ? { arch } : {}),
    ...(version !== undefined ? { version } : {}),
  });
}
