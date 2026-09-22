import type {
  DesktopSshEnvironmentTarget,
  DesktopSshHostKeyTrust,
} from "@t3tools/contracts";

import { formatDesktopSshTarget } from "./EnvironmentRow";

/**
 * Trust and install gating for a new SSH environment, run in the connect
 * handler before any provisioning starts. The connection platform re-checks
 * trust as a fail-safe; this module is where the user actually approves the
 * host key and the remote install plan. Both confirmations run before the
 * first remote write.
 */
export interface SshConnectionGateDeps {
  readonly inspectTrust: (
    target: DesktopSshEnvironmentTarget,
  ) => Promise<DesktopSshHostKeyTrust>;
  readonly trustHost: (target: DesktopSshEnvironmentTarget) => Promise<void>;
  /** Returns undefined when no themed confirm host is mounted; gates fail closed. */
  readonly confirm: (
    message: string,
    options?: { readonly variant?: "default" | "destructive" },
  ) => Promise<boolean> | undefined;
}

export type SshConnectionGateResult =
  | { readonly status: "proceed" }
  | { readonly status: "blocked"; readonly message: string }
  | { readonly status: "cancelled"; readonly message: string };

function formatFingerprintLine(trust: DesktopSshHostKeyTrust): string {
  const keyType = trust.keyType ?? "unknown key type";
  const fingerprint = trust.fingerprint ?? "unavailable (ssh-keygen could not read the key)";
  return `Key: ${keyType}\nFingerprint: ${fingerprint}`;
}

/**
 * Inspects host trust and asks the user to trust a new key, then confirms the
 * install plan before the first remote write. Never trusts a changed key —
 * that always blocks.
 */
export async function gateSshEnvironmentConnection(input: {
  readonly target: DesktopSshEnvironmentTarget;
  readonly version: string;
  readonly deps: SshConnectionGateDeps;
}): Promise<SshConnectionGateResult> {
  const { target, version, deps } = input;
  const host = formatDesktopSshTarget(target);

  const trust = await deps.inspectTrust(target);
  if (trust.status === "changed") {
    return {
      status: "blocked",
      message:
        `The SSH host key for ${host} changed. ACode will not connect or accept the new key automatically. ` +
        "Verify the key with the host's administrator, remove the old known_hosts entry, then try again.",
    };
  }
  if (trust.status === "new") {
    const confirmed = await deps.confirm(
      `Trust this SSH host?\n\nHost: ${host}\n${formatFingerprintLine(trust)}\n\nOnly continue if you expected this key. ACode stores it in known_hosts.`,
    );
    if (confirmed === undefined) {
      return {
        status: "blocked",
        message: "Host key confirmation is unavailable, so the host cannot be trusted.",
      };
    }
    if (!confirmed) {
      return { status: "cancelled", message: `Host key for ${host} was not trusted.` };
    }
    await deps.trustHost(target);
  }

  const installConfirmed = await deps.confirm(
    `Set up the ACode daemon on ${host}?\n\n` +
      `Version: ${version}\n` +
      `Install path: ~/.acode/runtime/versions/${version}/\n` +
      `Package: acode-server-${version}-linux-x64.tar.gz from GitHub Releases, verified against SHA256SUMS. If the remote download fails, this device uploads its cached copy instead.\n\n` +
      "The host must be Linux x64 with Node.js 22 or newer and Git already installed; ACode does not install system packages. A healthy existing daemon of a compatible version is reused as-is.",
  );
  if (installConfirmed === undefined) {
    return {
      status: "blocked",
      message: "Install confirmation is unavailable, so the remote setup cannot proceed.",
    };
  }
  if (!installConfirmed) {
    return { status: "cancelled", message: `Setup on ${host} was not confirmed.` };
  }
  return { status: "proceed" };
}
