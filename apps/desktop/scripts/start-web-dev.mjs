import { spawn } from "node:child_process";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const desktopRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const repositoryRoot = resolve(desktopRoot, "../..");

const child = spawn("pnpm", ["dev:web"], {
  cwd: repositoryRoot,
  env: process.env,
  stdio: "inherit",
});

child.on("error", (error) => {
  console.error(`Unable to start the ACode web development server: ${error.message}`);
  process.exitCode = 1;
});

child.on("exit", (code, signal) => {
  if (signal) {
    process.kill(process.pid, signal);
    return;
  }
  process.exitCode = code ?? 1;
});
