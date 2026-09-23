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
