import * as NodePath from "node:path";
import * as NodeURL from "node:url";

import { resolveDesktopDevPorts } from "../../../packages/shared/src/daemonPort.ts";
import {
  nodeEntryInvocation,
  resolvePackageEntry,
  spawnInherited,
} from "../../../scripts/lib/spawn-command.ts";

const desktopRoot = NodePath.resolve(
  NodePath.dirname(NodeURL.fileURLToPath(import.meta.url)),
  "..",
);
const repositoryRoot = NodePath.resolve(desktopRoot, "../..");
const inheritedHome = process.env.ACODE_HOME?.trim() || process.env.T3CODE_HOME?.trim();
const developmentHome = inheritedHome || NodePath.resolve(repositoryRoot, ".acode");

// Resolved through the same authority the daemon launcher binds with, so the
// daemon port, the web dev proxy target, and the window URL cannot disagree. The
// proxy matters because in dev the web client sends every `/api`, `/ws`, and
// `/oauth` request through the Vite server.
const resolvedPorts = resolveDesktopDevPorts(process.env);
if (resolvedPorts._tag === "invalid") {
  console.error(`[acode] ${resolvedPorts.message}`);
  process.exit(1);
}
const { daemonPort, webPort } = resolvedPorts.ports;
const cliArgs = process.argv.slice(2);
const hasExplicitConfig = cliArgs.some((argument) => argument === "--config" || argument === "-c");
const tauriArgs =
  cliArgs[0] === "dev" && !hasExplicitConfig
    ? [
        cliArgs[0],
        "--config",
        NodePath.resolve(desktopRoot, "src-tauri/tauri.dev.conf.json"),
        // `devUrl` in tauri.conf.json is a literal, so it has to follow the web
        // dev port instead of assuming offset 0. Otherwise a session on a
        // non-zero offset serves 5733+offset while the window loads 5733 —
        // another session's server, or nothing at all. Merged after the dev
        // config on purpose: later `--config` values win.
        "--config",
        JSON.stringify({ build: { devUrl: `http://localhost:${String(webPort)}` } }),
        ...cliArgs.slice(1),
      ]
    : cliArgs;

function launchTauriCli() {
  // The Tauri CLI is a Node program under `node_modules`. Launch its entry
  // point with this Node executable instead of `pnpm exec tauri`: on Windows
  // Node neither resolves the bare `pnpm` name through `PATHEXT` (`ENOENT`) nor
  // accepts the `.cmd` shim without a shell (`EINVAL`).
  const tauriEntry = resolvePackageEntry("@tauri-apps/cli/tauri.js", desktopRoot);
  return spawnInherited(nodeEntryInvocation(tauriEntry, tauriArgs), {
    cwd: desktopRoot,
    env: {
      ...process.env,
      ACODE_HOME: developmentHome,
      T3CODE_HOME: process.env.T3CODE_HOME?.trim() || developmentHome,
      T3CODE_PORT_OFFSET: String(resolvedPorts.ports.offset),
      // Pinned as a requirement, not a preference: the web dev proxy addresses
      // the daemon by this number, so a daemon that took a different one would
      // answer nothing. The launcher fails loudly instead of drifting.
      ACODE_DAEMON_PORT: String(daemonPort),
      T3CODE_PORT: String(daemonPort),
      // The web dev server must keep the port the window loads: walking to the
      // next free number would leave it serving a URL nothing reads.
      T3CODE_STRICT_DEV_PORTS: process.env.T3CODE_STRICT_DEV_PORTS?.trim() || "1",
    },
    failureLabel: "Unable to start the Tauri CLI",
  });
}

try {
  launchTauriCli();
} catch (error) {
  console.error(
    `Unable to start the Tauri CLI: ${error instanceof Error ? error.message : String(error)}`,
  );
  process.exitCode = 1;
}
