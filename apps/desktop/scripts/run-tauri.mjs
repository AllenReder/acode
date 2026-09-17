import { spawn } from "node:child_process";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const desktopRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const repositoryRoot = resolve(desktopRoot, "../..");
const inheritedHome = process.env.ACODE_HOME?.trim() || process.env.T3CODE_HOME?.trim();
const developmentHome = inheritedHome || resolve(repositoryRoot, ".acode");

const child = spawn("pnpm", ["exec", "tauri", ...process.argv.slice(2)], {
  cwd: desktopRoot,
  env: {
    ...process.env,
    ACODE_HOME: developmentHome,
    T3CODE_HOME: process.env.T3CODE_HOME?.trim() || developmentHome,
    T3CODE_PORT_OFFSET: process.env.T3CODE_PORT_OFFSET?.trim() || "0",
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
