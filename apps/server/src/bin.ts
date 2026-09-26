import * as NodeRuntime from "@effect/platform-node/NodeRuntime";
import * as NodeServices from "@effect/platform-node/NodeServices";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Runtime from "effect/Runtime";
import { Command } from "effect/unstable/cli";

import * as NetService from "@awen/shared/Net";
import packageJson from "../package.json" with { type: "json" };
import {
  makeDevRunnerStopHandshake,
  withDevRunnerStopSignal,
  writeDevRunnerStopAck,
} from "./devRunnerStop.ts";
import { authCommand } from "./cli/auth.ts";
import { appCommand } from "./cli/app.ts";
import { daemonCommand } from "./cli/daemon.ts";
import { pairCommand } from "./cli/pair.ts";
import { sharedServerCommandFlags } from "./cli/config.ts";
import { isEntrypoint } from "./entrypoint.ts";
import { projectCommand } from "./cli/project.ts";
import { runServerCommand, serveCommand, startCommand } from "./cli/server.ts";
import { serviceCommand } from "./cli/service.ts";
import { uninstallCommand } from "./cli/uninstall.ts";
import { updateCommand } from "./cli/update.ts";
import { claudeHistoryCommand } from "./cli/claudeHistory.ts";
import { serviceLauncherCommand } from "./cli/serviceLauncher.ts";
import { servicePreflightCommand } from "./cli/servicePreflight.ts";
import { sshHelperCommand } from "./cli/sshHelper.ts";
import { themeCommand } from "./cli/theme.ts";

const CliRuntimeLayer = Layer.mergeAll(NodeServices.layer, NetService.layer);

export const makeCli = () =>
  Command.make("awen", { ...sharedServerCommandFlags }).pipe(
    Command.withDescription("Run the Awen server."),
    Command.withHandler((flags) => runServerCommand(flags)),
    Command.withSubcommands([
      startCommand,
      serveCommand,
      appCommand,
      pairCommand,
      authCommand,
      projectCommand,
      serviceCommand,
      updateCommand,
      uninstallCommand,
      serviceLauncherCommand,
      claudeHistoryCommand,
      servicePreflightCommand,
      sshHelperCommand,
      themeCommand,
      daemonCommand,
    ]),
  );

export const cli = makeCli();

if (
  isEntrypoint({
    moduleUrl: import.meta.url,
    entryPath: process.argv[1],
    runtimeMain: import.meta.main,
  })
) {
  const devRunnerStop = makeDevRunnerStopHandshake(process.env);
  const program = Command.run(cli, { version: packageJson.version });
  NodeRuntime.runMain(
    (devRunnerStop === undefined ? program : withDevRunnerStopSignal(program, devRunnerStop)).pipe(
      Effect.scoped,
      Effect.provide(CliRuntimeLayer),
    ),
    {
      teardown: (exit, onExit) => {
        if (devRunnerStop !== undefined) writeDevRunnerStopAck(devRunnerStop);
        Runtime.defaultTeardown(exit, onExit);
      },
    },
  );
}
