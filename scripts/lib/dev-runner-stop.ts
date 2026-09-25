/**
 * Cross-process stop requests for `scripts/dev-runner.ts`.
 *
 * The runner can already turn an interrupt into its normal Effect scope
 * teardown. The missing piece on Windows is a way to deliver that interrupt
 * without `process.kill`, which Windows implements as `TerminateProcess` and
 * therefore never runs signal handlers or finalizers.
 *
 * A pid-scoped marker gives every runner a small, filesystem-visible control
 * channel. The content is descriptive; the atomic rename is the request. The
 * runner watches this path on Windows and closes its own scope when it
 * appears, so the child-process finalizer can use `taskkill /T /F` while the
 * `vp` tree is still addressable. POSIX keeps its existing process-group and
 * Ctrl+C path unchanged, so this marker is intentionally Windows-only there.
 */

// @effect-diagnostics nodeBuiltinImport:off - Standalone harness and runner control share a filesystem protocol.

import * as NodeFSP from "node:fs/promises";
import * as NodePath from "node:path";

export const DEV_RUNNER_STOP_VERSION = 1 as const;

export interface DevRunnerStopRequest {
  readonly version: typeof DEV_RUNNER_STOP_VERSION;
  readonly pid: number;
}

/** A request target that cannot be confused with another runner file. */
export function devRunnerStopRequestPath(baseDir: string, runnerPid: number): string {
  return NodePath.join(baseDir, "runtime", "dev-runner", `${runnerPid}.stop`);
}

/**
 * Publish a stop request for `runnerPid`.
 *
 * The final rename means a watcher never observes a half-written request.
 * A duplicate request is harmless: whichever writer wins leaves the same
 * signal at the same path, and the runner removes it during shutdown.
 */
export async function requestDevRunnerStop(baseDir: string, runnerPid: number): Promise<string> {
  if (!Number.isSafeInteger(runnerPid) || runnerPid <= 0) {
    throw new Error(`Invalid dev-runner pid: ${String(runnerPid)}`);
  }

  const requestPath = devRunnerStopRequestPath(baseDir, runnerPid);
  const temporaryPath = `${requestPath}.${String(process.pid)}.tmp`;
  const request: DevRunnerStopRequest = { pid: runnerPid, version: DEV_RUNNER_STOP_VERSION };
  await NodeFSP.mkdir(NodePath.dirname(requestPath), { recursive: true });
  await NodeFSP.writeFile(temporaryPath, `${JSON.stringify(request)}\n`, {
    encoding: "utf8",
    mode: 0o600,
  });
  try {
    await NodeFSP.rename(temporaryPath, requestPath);
  } catch (cause) {
    await NodeFSP.rm(temporaryPath, { force: true });
    throw cause;
  }
  return requestPath;
}
