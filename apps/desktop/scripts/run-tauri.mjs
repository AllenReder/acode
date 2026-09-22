import * as NodePath from "node:path";
import * as NodeURL from "node:url";

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
// One number has to serve as both the daemon port and the web dev proxy target:
// in dev the web client sends every `/api`, `/ws`, and `/oauth` request through
// the Vite server, so a daemon bound anywhere else answers nothing. Stating it
// as ACODE_DAEMON_PORT (rather than only T3CODE_PORT) makes the launcher fail
// loudly when the port is taken instead of drifting to a free one, which used to
// leave the proxy dialing a dead port while a healthy daemon listened elsewhere.
const daemonPort =
  process.env.ACODE_DAEMON_PORT?.trim() || process.env.T3CODE_PORT?.trim() || "13773";
const cliArgs = process.argv.slice(2);
const hasExplicitConfig = cliArgs.some((argument) => argument === "--config" || argument === "-c");
const tauriArgs =
  cliArgs[0] === "dev" && !hasExplicitConfig
    ? [
        cliArgs[0],
        "--config",
        NodePath.resolve(desktopRoot, "src-tauri/tauri.dev.conf.json"),
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
      T3CODE_PORT_OFFSET: process.env.T3CODE_PORT_OFFSET?.trim() || "0",
      ACODE_DAEMON_PORT: daemonPort,
      T3CODE_PORT: daemonPort,
      // This window's URL is the literal `devUrl` in tauri.conf.json, so the web
      // dev server must keep the port the offset implies: walking to the next
      // free number would leave the window loading whatever else serves that URL.
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
