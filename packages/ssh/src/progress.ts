import type { DesktopSshEnvironmentProgress } from "@awen/contracts";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";

export class SshEnvironmentProgress extends Context.Service<
  SshEnvironmentProgress,
  { readonly report: (progress: DesktopSshEnvironmentProgress) => void }
>()("@awen/ssh/progress/SshEnvironmentProgress") {}

export const reportSshProgress = (progress: DesktopSshEnvironmentProgress) =>
  Effect.gen(function* () {
    const service = yield* Effect.serviceOption(SshEnvironmentProgress);
    if (Option.isSome(service)) service.value.report(progress);
  });

export const sshProgress = (
  stage: DesktopSshEnvironmentProgress["stage"],
  options: Partial<Omit<DesktopSshEnvironmentProgress, "stage">> = {},
): DesktopSshEnvironmentProgress => ({
  stage,
  detail: options.detail ?? null,
  transferredBytes: options.transferredBytes ?? null,
  totalBytes: options.totalBytes ?? null,
});
