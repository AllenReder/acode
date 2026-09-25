import type { ConnectionFailureCode } from "@awen/contracts";

/**
 * The daemon reports SSH password-prompt cancellation as a typed marker
 * (`DesktopSshPasswordPromptCancelledType`); the desktop bridge rethrows it as
 * this typed error so the connection platform can classify cancellation
 * without sniffing message text. Kept in its own module so effect-land
 * connection code never imports the Tauri bridge.
 */
export class SshPasswordPromptCancelledError extends Error {
  override readonly name = "SshPasswordPromptCancelledError";
}

/**
 * Error raised by the desktop SSH API client after preserving the daemon's
 * stable failure code. Connection onboarding maps this without parsing text.
 */
export class DesktopSshRequestError extends Error {
  override readonly name = "DesktopSshRequestError";

  constructor(
    readonly code: ConnectionFailureCode,
    message: string,
    readonly status: number | null = null,
  ) {
    super(message);
  }
}
