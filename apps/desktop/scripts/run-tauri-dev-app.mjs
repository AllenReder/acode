import { spawn, spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const desktopRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const repositoryRoot = resolve(desktopRoot, "../..");
const developmentHome = process.env.ACODE_HOME?.trim() || resolve(repositoryRoot, ".acode");
const devConfig = resolve(desktopRoot, "src-tauri/tauri.dev.conf.json");

const environment = {
  ...process.env,
  ACODE_HOME: developmentHome,
  T3CODE_HOME: process.env.T3CODE_HOME?.trim() || developmentHome,
  T3CODE_PORT_OFFSET: process.env.T3CODE_PORT_OFFSET?.trim() || "0",
};

const build = spawnSync("pnpm", ["exec", "tauri", "build", "--debug", "--config", devConfig], {
  cwd: desktopRoot,
  env: environment,
  stdio: "inherit",
});

if (build.error) {
  console.error(`Unable to build the ACode Dev app: ${build.error.message}`);
  process.exitCode = 1;
} else if (build.status !== 0) {
  process.exitCode = build.status ?? 1;
} else {
  const bundleRoot = resolve(desktopRoot, "src-tauri/target/debug/bundle/macos");
  const preferredAppPath = join(bundleRoot, "ACode Dev.app");
  if (!existsSync(preferredAppPath)) {
    console.error(`The ACode Dev app bundle was not found under ${bundleRoot}.`);
    process.exitCode = 1;
  } else {
    const appPath = preferredAppPath;
    const executable = join(appPath, "Contents/MacOS/acode-desktop");
    if (!existsSync(executable)) {
      console.error(`The ACode Dev executable was not found at ${executable}.`);
      process.exitCode = 1;
    } else {
      const child = spawn(executable, [], {
        cwd: repositoryRoot,
        env: environment,
        detached: true,
        stdio: "inherit",
      });
      child.unref();
      console.log(`Started ACode Dev: ${appPath}`);
    }
  }
}
