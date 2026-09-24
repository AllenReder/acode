import type {
  DesktopSshEnvironmentTarget,
  DesktopSshHostKeyTrust,
  DesktopSshEnvironmentPlan,
} from "@awen/contracts";

import { formatDesktopSshTarget } from "./EnvironmentRow";

/**
 * Trust and install gating for a new SSH environment, run in the connect
 * handler before any provisioning starts. The connection platform re-checks
 * trust as a fail-safe; this module is where the user actually approves the
 * host key and the remote install plan. Both confirmations run before the
 * first remote write.
 */
export interface SshConnectionGateDeps {
  readonly resolveTarget: (
    target: DesktopSshEnvironmentTarget,
  ) => Promise<DesktopSshEnvironmentTarget>;
  readonly inspectTrust: (target: DesktopSshEnvironmentTarget) => Promise<DesktopSshHostKeyTrust>;
  readonly inspectPlan: (target: DesktopSshEnvironmentTarget) => Promise<DesktopSshEnvironmentPlan>;
  readonly trustHost: (
    target: DesktopSshEnvironmentTarget,
    keyType: string,
    fingerprint: string,
  ) => Promise<void>;
  /** Returns undefined when no themed confirm host is mounted; gates fail closed. */
  readonly confirm: (
    message: string,
    options?: { readonly variant?: "default" | "destructive" },
  ) => Promise<boolean> | undefined;
}

export type SshConnectionGateResult =
  | { readonly status: "proceed"; readonly target: DesktopSshEnvironmentTarget }
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
  const resolvedTarget = await deps.resolveTarget(target);
  const connectionTarget = {
    ...resolvedTarget,
    username: target.username ?? resolvedTarget.username,
    port: target.port ?? resolvedTarget.port,
  };
  const host = formatDesktopSshTarget(connectionTarget);

  const trust = await deps.inspectTrust(connectionTarget);
  if (trust.status === "changed") {
    return {
      status: "blocked",
      message:
        `The SSH host key for ${host} changed. Awen will not connect or accept the new key automatically. ` +
        "Verify the key with the host's administrator, remove the old known_hosts entry, then try again.",
    };
  }
  if (trust.status === "new") {
    if (!trust.keyType || !trust.fingerprint) {
      return {
        status: "blocked",
        message: `Could not read the SSH host key fingerprint for ${host}.`,
      };
    }
    const confirmed = await deps.confirm(
      `Trust this SSH host?\n\nHost: ${host}\n${formatFingerprintLine(trust)}\n\nOnly continue if you expected this key. Awen stores it in known_hosts.`,
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
    await deps.trustHost(connectionTarget, trust.keyType, trust.fingerprint);
  }

  const plan = await deps.inspectPlan(connectionTarget);
  if (plan.version !== version) {
    return {
      status: "blocked",
      message: `The local daemon version ${plan.version} does not match this desktop version ${version}.`,
    };
  }
  const prerequisites = [
    `OS: ${plan.os || "unavailable"}`,
    `Architecture: ${plan.arch || "unavailable"}`,
    `Node.js: ${plan.nodeVersion ?? "missing"}${plan.nodeSupported ? " (supported)" : " (requires ^22.16, ^23.11, or >=24.10)"}`,
    `Git: ${plan.gitAvailable ? "available" : "missing"}`,
  ].join("\n");
  if (
    plan.os !== "Linux" ||
    !["x86_64", "amd64"].includes(plan.arch) ||
    !plan.nodeSupported ||
    !plan.gitAvailable
  ) {
    return {
      status: "blocked",
      message: `The SSH host does not meet Awen's prerequisites.\n\n${prerequisites}`,
    };
  }
  const installConfirmed = await deps.confirm(
    `${plan.daemon === "reuse" ? "Connect to the existing Awen daemon" : "Set up the Awen daemon"} on ${host}?\n\n` +
      `Version: ${version}\n` +
      `Install path: ~/.awen/runtime/versions/${version}/\n` +
      `Plan: ${plan.daemon === "reuse" ? "Reuse the responding daemon; install if it becomes unavailable." : "Install or repair the daemon."}\n` +
      `Package: awen-server-${version}-linux-x64.tar.gz from GitHub Releases, verified against SHA256SUMS. If the remote download fails, this device uploads its cached copy instead.\n\n` +
      `${prerequisites}\n\nAwen does not install system packages.`,
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
  return { status: "proceed", target: connectionTarget };
}
