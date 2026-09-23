import { describe, expect, it, vi } from "vite-plus/test";
import type { DesktopSshEnvironmentTarget, DesktopSshHostKeyTrust } from "@t3tools/contracts";

import { gateSshEnvironmentConnection, type SshConnectionGateDeps } from "./sshConnectionGate";

const TARGET: DesktopSshEnvironmentTarget = {
  alias: "devbox",
  hostname: "devbox.example.test",
  username: "allen",
  port: 22,
};

function makeDeps(overrides: Partial<SshConnectionGateDeps> = {}) {
  const confirm = vi.fn().mockResolvedValue(true);
  const deps: SshConnectionGateDeps = {
    resolveTarget: vi.fn().mockImplementation(async (target) => target),
    inspectTrust: vi.fn().mockResolvedValue({
      status: "trusted",
      fingerprint: null,
      keyType: null,
    } satisfies DesktopSshHostKeyTrust),
    inspectPlan: vi.fn().mockResolvedValue({
      version: "1.2.3",
      os: "Linux",
      arch: "x86_64",
      nodeVersion: "v22.16.0",
      nodeSupported: true,
      gitAvailable: true,
      daemon: "install",
    }),
    trustHost: vi.fn().mockResolvedValue(undefined),
    confirm,
    ...overrides,
  };
  return { deps, confirm };
}

describe("gateSshEnvironmentConnection", () => {
  it("blocks a changed host key without trusting or asking anything", async () => {
    const { deps, confirm } = makeDeps({
      inspectTrust: vi.fn().mockResolvedValue({
        status: "changed",
        fingerprint: "SHA256:new",
        keyType: "ssh-ed25519",
      } satisfies DesktopSshHostKeyTrust),
    });

    const result = await gateSshEnvironmentConnection({
      target: TARGET,
      version: "1.2.3",
      deps,
    });

    expect(result.status).toBe("blocked");
    expect(result.status === "blocked" && result.message).toContain("changed");
    expect(deps.trustHost).not.toHaveBeenCalled();
    expect(confirm).not.toHaveBeenCalled();
  });

  it("resolves SSH config aliases before inspecting and returning the target", async () => {
    const requestedTarget = { ...TARGET, hostname: "dev", port: 6000 };
    const configuredTarget = {
      ...TARGET,
      hostname: "dev.example.test",
      username: "configured-user",
      port: 22,
    };
    const effectiveTarget = { ...configuredTarget, username: "allen", port: 6000 };
    const { deps } = makeDeps({
      resolveTarget: vi.fn().mockResolvedValue(configuredTarget),
    });

    const result = await gateSshEnvironmentConnection({
      target: requestedTarget,
      version: "1.2.3",
      deps,
    });

    expect(deps.inspectTrust).toHaveBeenCalledWith(effectiveTarget);
    expect(deps.inspectPlan).toHaveBeenCalledWith(effectiveTarget);
    expect(result).toEqual({ status: "proceed", target: effectiveTarget });
  });

  it("shows host, key type, and fingerprint before trusting a new host", async () => {
    const { deps, confirm } = makeDeps({
      inspectTrust: vi.fn().mockResolvedValue({
        status: "new",
        fingerprint: "SHA256:abc123",
        keyType: "ssh-ed25519",
      } satisfies DesktopSshHostKeyTrust),
    });

    const result = await gateSshEnvironmentConnection({
      target: TARGET,
      version: "1.2.3",
      deps,
    });

    expect(result.status).toBe("proceed");
    const trustMessage = confirm.mock.calls[0]?.[0] as string;
    expect(trustMessage).toContain("allen@devbox.example.test:22");
    expect(trustMessage).toContain("ssh-ed25519");
    expect(trustMessage).toContain("SHA256:abc123");
    expect(deps.trustHost).toHaveBeenCalledWith(TARGET, "ssh-ed25519", "SHA256:abc123");
  });

  it("blocks a new host when its fingerprint is unavailable", async () => {
    const { deps, confirm } = makeDeps({
      inspectTrust: vi.fn().mockResolvedValue({
        status: "new",
        fingerprint: null,
        keyType: null,
      } satisfies DesktopSshHostKeyTrust),
    });

    const result = await gateSshEnvironmentConnection({
      target: TARGET,
      version: "1.2.3",
      deps,
    });

    expect(result.status).toBe("blocked");
    expect(confirm).not.toHaveBeenCalled();
    expect(deps.trustHost).not.toHaveBeenCalled();
  });

  it("aborts without trusting when the user declines a new host key", async () => {
    const confirmMock = vi.fn().mockResolvedValue(false);
    const { deps } = makeDeps({
      inspectTrust: vi.fn().mockResolvedValue({
        status: "new",
        fingerprint: "SHA256:abc123",
        keyType: "ssh-ed25519",
      } satisfies DesktopSshHostKeyTrust),
      confirm: confirmMock,
    });

    const result = await gateSshEnvironmentConnection({
      target: TARGET,
      version: "1.2.3",
      deps,
    });

    expect(result.status).toBe("cancelled");
    expect(deps.trustHost).not.toHaveBeenCalled();
    // The install plan is never shown after a declined trust.
    expect(confirmMock).toHaveBeenCalledTimes(1);
  });

  it("fails closed when no confirm host is mounted for a new key", async () => {
    const { deps } = makeDeps({
      inspectTrust: vi.fn().mockResolvedValue({
        status: "new",
        fingerprint: null,
        keyType: null,
      } satisfies DesktopSshHostKeyTrust),
      confirm: vi.fn().mockReturnValue(undefined),
    });

    const result = await gateSshEnvironmentConnection({
      target: TARGET,
      version: "1.2.3",
      deps,
    });

    expect(result.status).toBe("blocked");
    expect(deps.trustHost).not.toHaveBeenCalled();
  });

  it("confirms the install plan with version, path, source, and prerequisites", async () => {
    const { deps, confirm } = makeDeps();

    const result = await gateSshEnvironmentConnection({
      target: TARGET,
      version: "1.2.3",
      deps,
    });

    expect(result.status).toBe("proceed");
    expect(deps.trustHost).not.toHaveBeenCalled();
    expect(confirm).toHaveBeenCalledTimes(1);
    const message = confirm.mock.calls[0]?.[0] as string;
    expect(message).toContain("allen@devbox.example.test:22");
    expect(message).toContain("1.2.3");
    expect(message).toContain("~/.acode/runtime/versions/1.2.3/");
    expect(message).toContain("acode-server-1.2.3-linux-x64.tar.gz");
    expect(message).toContain("SHA256SUMS");
    expect(message).toContain("OS: Linux");
    expect(message).toContain("Architecture: x86_64");
    expect(message).toContain("Node.js: v22.16.0");
    expect(message).toContain("Git");
  });

  it("describes reuse without claiming an installation is required", async () => {
    const { deps, confirm } = makeDeps({
      inspectPlan: vi.fn().mockResolvedValue({
        version: "1.2.3",
        os: "Linux",
        arch: "x86_64",
        nodeVersion: "v22.16.0",
        nodeSupported: true,
        gitAvailable: true,
        daemon: "reuse",
      }),
    });
    const result = await gateSshEnvironmentConnection({ target: TARGET, version: "1.2.3", deps });
    expect(result.status).toBe("proceed");
    expect(confirm).toHaveBeenCalledTimes(1);
    expect(confirm.mock.calls[0]?.[0]).toContain("Reuse the responding daemon");
  });

  it("blocks missing remote prerequisites before install confirmation", async () => {
    const { deps, confirm } = makeDeps({
      inspectPlan: vi.fn().mockResolvedValue({
        version: "1.2.3",
        os: "Linux",
        arch: "x86_64",
        nodeVersion: "v22.15.0",
        nodeSupported: false,
        gitAvailable: false,
        daemon: "install",
      }),
    });
    const result = await gateSshEnvironmentConnection({ target: TARGET, version: "1.2.3", deps });
    expect(result.status).toBe("blocked");
    expect(result.status === "blocked" && result.message).toContain("v22.15.0");
    expect(confirm).not.toHaveBeenCalled();
  });

  it("asks trust and install separately for a new host", async () => {
    const { deps, confirm } = makeDeps({
      inspectTrust: vi.fn().mockResolvedValue({
        status: "new",
        fingerprint: "SHA256:abc123",
        keyType: "ssh-ed25519",
      } satisfies DesktopSshHostKeyTrust),
    });

    await gateSshEnvironmentConnection({ target: TARGET, version: "1.2.3", deps });

    expect(confirm).toHaveBeenCalledTimes(2);
    expect(confirm.mock.calls[0]?.[0]).toContain("Trust this SSH host?");
    expect(confirm.mock.calls[1]?.[0]).toContain("Set up the ACode daemon");
  });

  it("cancels the connect when the install plan is declined", async () => {
    const { deps } = makeDeps({ confirm: vi.fn().mockResolvedValue(false) });

    const result = await gateSshEnvironmentConnection({
      target: TARGET,
      version: "1.2.3",
      deps,
    });

    expect(result.status).toBe("cancelled");
  });
});
