import type { ProviderRequestKind } from "@awen/contracts";

/**
 * Declares the request kinds each adapter can emit and answer. The UI reads
 * this through the provider snapshot so unsupported requests are blocked before
 * a client sends an approval response.
 */
export const ACP_APPROVAL_REQUEST_KINDS = [
  "command",
  "file-read",
  "file-change",
] as const satisfies ReadonlyArray<ProviderRequestKind>;

export const CODEX_APPROVAL_REQUEST_KINDS = [
  "command",
  "file-read",
  "file-change",
  "mcp-elicitation",
] as const satisfies ReadonlyArray<ProviderRequestKind>;

export const CLAUDE_APPROVAL_REQUEST_KINDS = ACP_APPROVAL_REQUEST_KINDS;
export const GROK_APPROVAL_REQUEST_KINDS = ACP_APPROVAL_REQUEST_KINDS;
export const CURSOR_APPROVAL_REQUEST_KINDS = ACP_APPROVAL_REQUEST_KINDS;
export const OPENCODE_APPROVAL_REQUEST_KINDS = ACP_APPROVAL_REQUEST_KINDS;
export const ANTIGRAVITY_APPROVAL_REQUEST_KINDS = ACP_APPROVAL_REQUEST_KINDS;
