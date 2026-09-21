import * as NodeChildProcess from "node:child_process";
import * as NodePath from "node:path";
import * as NodeURL from "node:url";

const desktopRoot = NodePath.resolve(
  NodePath.dirname(NodeURL.fileURLToPath(import.meta.url)),
  "..",
);
const repositoryRoot = NodePath.resolve(desktopRoot, "../..");
const inheritedHome = process.env.ACODE_HOME?.trim() || process.env.T3CODE_HOME?.trim();
const developmentHome = inheritedHome || NodePath.resolve(repositoryRoot, ".acode");
const cliArgs = process.argv.slice(2);
const hasExplicitConfig = cliArgs.some((argument) => argument === "--config" || argument === "-c");
const tauriArgs =
  cliArgs[0] === "dev" && !hasExplicitConfig
    ? [
        "exec",
        "tauri",
        "dev",
        "--config",
        NodePath.resolve(desktopRoot, "src-tauri/tauri.dev.conf.json"),
        ...cliArgs.slice(1),
      ]
    : ["exec", "tauri", ...cliArgs];

const child = NodeChildProcess.spawn("pnpm", tauriArgs, {
  cwd: desktopRoot,
  env: {
    ...process.env,
    ACODE_HOME: developmentHome,
    T3CODE_HOME: process.env.T3CODE_HOME?.trim() || developmentHome,
    T3CODE_PORT_OFFSET: process.env.T3CODE_PORT_OFFSET?.trim() || "0",
    T3CODE_PORT: process.env.T3CODE_PORT?.trim() || "13773",
  },
  stdio: "inherit",
});

child.on("error", (error) => {
  console.error(`Unable to start the Tauri CLI: ${error.message}`);
  process.exitCode = 1;
});

child.on("exit", (code, signal) => {
  if (signal) {
    process.kill(process.pid, signal);
    return;
  }
  process.exitCode = code ?? 1;
});
