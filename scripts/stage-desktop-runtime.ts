#!/usr/bin/env node
// @effect-diagnostics nodeBuiltinImport:off globalConsole:off
import * as NodeChildProcess from "node:child_process";
import * as NodeFS from "node:fs";
import * as NodePath from "node:path";
import { HostProcessPlatform } from "@awen/shared/hostProcess";
import * as Effect from "effect/Effect";
import { packageManagerInvocation } from "./lib/spawn-command.ts";

const root = NodePath.resolve(import.meta.dirname, "..");
const stageRelative = "apps/desktop/runtime";
const stage = NodePath.join(root, stageRelative);
const platform = Effect.runSync(HostProcessPlatform);
const nodeName = platform === "win32" ? "node.exe" : "node";

if (platform === "darwin") {
  const linkedLibraries = NodeChildProcess.execFileSync("otool", ["-L", process.execPath], {
    encoding: "utf8",
  });
  if (/\/(?:opt\/homebrew|usr\/local)\/.*\.dylib/u.test(linkedLibraries)) {
    throw new Error("Desktop packaging needs a standalone Node binary; the current Node links Homebrew libraries.");
  }
}

function runPnpm(args: string[]): void {
  const invocation = packageManagerInvocation(args);
  const result = NodeChildProcess.spawnSync(invocation.command, [...invocation.args], {
    cwd: root,
    stdio: "inherit",
    shell: invocation.shell,
  });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`pnpm exited with ${result.status}`);
}

runPnpm(["build"]);
NodeFS.rmSync(stage, { recursive: true, force: true });
runPnpm(["--config.confirmModulesPurge=false", "--filter=@awen/server", "deploy", "--legacy", "--prod", stageRelative]);

NodeFS.copyFileSync(process.execPath, NodePath.join(stage, nodeName));
if (platform !== "win32") {
  NodeFS.chmodSync(NodePath.join(stage, nodeName), 0o755);
}

if (!NodeFS.existsSync(NodePath.join(stage, "dist/bin.mjs"))) {
  throw new Error("The staged desktop runtime is missing dist/bin.mjs.");
}
console.log(`[awen] staged desktop daemon and Node runtime in ${stage}`);
