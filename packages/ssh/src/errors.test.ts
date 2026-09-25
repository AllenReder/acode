import { describe, expect, it } from "vite-plus/test";

import {
  classifySshFailure,
  SshCommandError,
  SshHostDiscoveryError,
  SshLocalPackageError,
  SshPairingError,
  SshPasswordPromptError,
  SshReadinessError,
} from "./errors.ts";

function commandError(stderr: string): SshCommandError {
  return new SshCommandError({
    message: stderr,
    command: ["ssh", "devbox"],
    exitCode: 255,
    stderr,
  });
}

describe("classifySshFailure", () => {
  it("prefers stable remote markers over message heuristics", () => {
    expect(
      classifySshFailure(
        commandError(
          "AWEN_ERROR prerequisite-missing Remote host is missing Git on PATH. Install Git before connecting Awen.",
        ),
      ),
    ).toEqual({
      code: "prerequisite-missing",
      detail: "Remote host is missing Git on PATH. Install Git before connecting Awen.",
    });
  });

  it("classifies checksum and install markers as package failures", () => {
    expect(
      classifySshFailure(
        commandError(
          "AWEN_ERROR install-download-checksum Checksum mismatch for awen-server.tar.gz.",
        ),
      ),
    ).toMatchObject({ code: "install-download-checksum" });
  });

  it("classifies ssh authentication failures", () => {
    expect(
      classifySshFailure(
        commandError("root@devbox: Permission denied (publickey,password,keyboard-interactive)."),
      ).code,
    ).toBe("ssh-authentication");
    expect(
      classifySshFailure(new SshPasswordPromptError({ message: "Authentication cancelled." })).code,
    ).toBe("ssh-authentication");
  });

  it("classifies changed host keys separately from unreachable hosts", () => {
    expect(
      classifySshFailure(
        new SshHostDiscoveryError({
          message:
            "SSH host key changed for devbox. Awen never accepts a changed host key automatically.",
          cause: null,
        }),
      ).code,
    ).toBe("host-key-change");
    expect(
      classifySshFailure(commandError("ssh: connect to host devbox port 22: Connection refused"))
        .code,
    ).toBe("unreachable");
    expect(
      classifySshFailure(
        new SshHostDiscoveryError({
          message: "Failed to run SSH host key tool ssh-keyscan.",
          cause: null,
        }),
      ).code,
    ).toBe("unreachable");
  });

  it("classifies remote curl and wget failures as package acquisition failures", () => {
    expect(classifySshFailure(commandError("curl: (6) Could not resolve host")).code).toBe(
      "install-download-checksum",
    );
    expect(classifySshFailure(commandError("wget: unable to resolve host address")).code).toBe(
      "install-download-checksum",
    );
  });

  it("classifies daemon startup, pairing, and package failures", () => {
    expect(
      classifySshFailure(new SshReadinessError({ message: "Backend readiness probe failed." }))
        .code,
    ).toBe("daemon-start");
    expect(
      classifySshFailure(
        new SshPairingError({ message: "Invalid pairing credential.", stdout: "" }),
      ).code,
    ).toBe("daemon-authentication");
    expect(
      classifySshFailure(new SshLocalPackageError({ message: "Package SHA256 mismatch." })).code,
    ).toBe("install-download-checksum");
  });

  it("keeps unmapped failures explicit", () => {
    expect(classifySshFailure(new Error("unexpected transport failure"))).toEqual({
      code: "unknown",
      detail: "unexpected transport failure",
    });
  });
});
