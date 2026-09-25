import { ConnectionFailureCodeSchema, type ConnectionFailureCode } from "@awen/contracts";
import * as Data from "effect/Data";
import * as Schema from "effect/Schema";

export class SshHostDiscoveryError extends Data.TaggedError("SshHostDiscoveryError")<{
  readonly message: string;
  readonly cause: unknown;
}> {}

export class SshInvalidTargetError extends Data.TaggedError("SshInvalidTargetError")<{
  readonly message: string;
}> {}

export class SshCommandError extends Data.TaggedError("SshCommandError")<{
  readonly message: string;
  readonly command: readonly string[];
  readonly exitCode: number | null;
  readonly stderr: string;
  readonly stdout?: string;
  readonly cause?: unknown;
}> {}

export class SshLaunchError extends Data.TaggedError("SshLaunchError")<{
  readonly message: string;
  readonly stdout: string;
  readonly cause?: unknown;
}> {}

export class SshPairingError extends Data.TaggedError("SshPairingError")<{
  readonly message: string;
  readonly stdout: string;
  readonly cause?: unknown;
}> {}

export class SshHttpBridgeError extends Data.TaggedError("SshHttpBridgeError")<{
  readonly message: string;
  readonly status?: number;
  readonly cause?: unknown;
}> {}

export class SshReadinessError extends Data.TaggedError("SshReadinessError")<{
  readonly message: string;
  readonly cause?: unknown;
}> {}

export class SshPasswordPromptError extends Data.TaggedError("SshPasswordPromptError")<{
  readonly message: string;
  readonly cause?: unknown;
}> {}

export class SshLocalPackageError extends Data.TaggedError("SshLocalPackageError")<{
  readonly message: string;
  readonly cause?: unknown;
}> {}

export interface ClassifiedSshFailure {
  readonly code: ConnectionFailureCode;
  readonly detail: string;
}

const AWEN_ERROR_MARKER = /(?:^|\r?\n)AWEN_ERROR ([a-z-]+) ([^\r\n]*)/gu;

function sshErrorText(error: unknown): string {
  if (error instanceof SshCommandError) {
    return [error.stderr, error.message, error.stdout ?? ""]
      .filter((part) => part.length > 0)
      .join("\n");
  }
  if (error instanceof SshLaunchError || error instanceof SshPairingError) {
    return [error.stdout, error.message].filter((part) => part.length > 0).join("\n");
  }
  return error instanceof Error ? error.message : String(error);
}

function stripErrorMessageMarkers(value: string): string {
  return value.replace(AWEN_ERROR_MARKER, "").trim();
}

function markedFailure(text: string): ClassifiedSshFailure | null {
  let found: ClassifiedSshFailure | null = null;
  for (const match of text.matchAll(AWEN_ERROR_MARKER)) {
    const code = match[1];
    if (code !== undefined && Schema.is(ConnectionFailureCodeSchema)(code)) {
      found = { code, detail: match[2]?.trim() || stripErrorMessageMarkers(text) };
    }
  }
  return found;
}

function hasAny(text: string, patterns: ReadonlyArray<RegExp>): boolean {
  return patterns.some((pattern) => pattern.test(text));
}

export function classifySshFailure(error: unknown): ClassifiedSshFailure {
  const text = sshErrorText(error);
  const marked = markedFailure(text);
  if (marked !== null) return marked;

  const normalized = text.toLowerCase();
  if (
    hasAny(normalized, [
      /host key verification failed/u,
      /remote host identification has changed/u,
      /host key changed/u,
      /host key.*changed/u,
    ])
  ) {
    return {
      code: "host-key-change",
      detail: stripErrorMessageMarkers(text) || "The SSH host key changed.",
    };
  }
  if (error instanceof SshHostDiscoveryError) {
    return {
      code: "unreachable",
      detail: stripErrorMessageMarkers(text) || "The SSH host could not be inspected.",
    };
  }
  if (
    error instanceof SshPasswordPromptError ||
    hasAny(normalized, [
      /permission denied \((?:publickey|password|keyboard-interactive|hostbased|gssapi-with-mic)[^)]*\)/u,
      /authentication failed/u,
      /too many authentication failures/u,
    ])
  ) {
    return {
      code: "ssh-authentication",
      detail: stripErrorMessageMarkers(text) || "SSH authentication failed.",
    };
  }
  if (error instanceof SshPairingError) {
    return {
      code: "daemon-authentication",
      detail: stripErrorMessageMarkers(text) || "The remote daemon rejected pairing.",
    };
  }
  if (error instanceof SshLocalPackageError) {
    return {
      code: "install-download-checksum",
      detail:
        stripErrorMessageMarkers(text) ||
        "The remote daemon package could not be verified or installed.",
    };
  }
  if (error instanceof SshReadinessError) {
    return {
      code: "daemon-start",
      detail: stripErrorMessageMarkers(text) || "The remote daemon did not become ready.",
    };
  }
  if (
    hasAny(normalized, [
      /remote host is missing/u,
      /missing node/u,
      /missing git/u,
      /node\.js 22 or newer/u,
      /supports linux x64 only/u,
      /prerequisite/u,
    ])
  ) {
    return { code: "prerequisite-missing", detail: stripErrorMessageMarkers(text) };
  }
  if (
    hasAny(normalized, [
      /checksum mismatch/u,
      /sha256/u,
      /remote download failed/u,
      /(?:curl|wget):/u,
      /download/u,
      /archive/u,
      /install(?:ation|er)?/u,
      /curl or wget/u,
      /does not run on this host/u,
      /server package/u,
    ])
  ) {
    return {
      code: "install-download-checksum",
      detail: stripErrorMessageMarkers(text),
    };
  }
  if (
    hasAny(normalized, [
      /daemon did not become ready/u,
      /failed to find an available port/u,
      /did not return a remote port/u,
      /launch returned/u,
      /readiness/u,
      /failed to start/u,
    ])
  ) {
    return { code: "daemon-start", detail: stripErrorMessageMarkers(text) };
  }
  if (
    hasAny(normalized, [
      /connection refused/u,
      /connection timed out/u,
      /could not resolve hostname/u,
      /no route to host/u,
      /network is unreachable/u,
      /operation timed out/u,
      /connection closed/u,
      /connection reset by peer/u,
      /kex_exchange_identification/u,
      /broken pipe/u,
    ])
  ) {
    return { code: "unreachable", detail: stripErrorMessageMarkers(text) };
  }
  return { code: "unknown", detail: stripErrorMessageMarkers(text) || "SSH connection failed." };
}
