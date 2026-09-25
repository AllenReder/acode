import {
  EnvironmentAuthInvalidError,
  EnvironmentOperationForbiddenError,
  EnvironmentRequestInvalidError,
  EnvironmentResourceNotFoundError,
  EnvironmentScopeRequiredError,
  AuthOrchestrationReadScope,
} from "@awen/contracts";
import {
  SshCommandError,
  SshHostDiscoveryError,
  SshHttpBridgeError,
  SshPasswordPromptError,
} from "@awen/ssh/errors";
import { describe, expect, it } from "vite-plus/test";

import {
  DesktopSshEnvironmentRequestError,
  remoteRequestFailureCode,
  sshErrorStatus,
  sshRequestErrorStatus,
} from "./sshRoutes.ts";

describe("remoteRequestFailureCode", () => {
  it("classifies declared daemon authentication failures", () => {
    expect(
      remoteRequestFailureCode(
        "bootstrap-bearer-session",
        new EnvironmentAuthInvalidError({
          code: "auth_invalid",
          reason: "invalid_credential",
          traceId: "trace-auth",
        }),
        null,
      ),
    ).toBe("daemon-authentication");
    expect(
      remoteRequestFailureCode(
        "fetch-session-state",
        new EnvironmentScopeRequiredError({
          code: "insufficient_scope",
          requiredScope: AuthOrchestrationReadScope,
          traceId: "trace-scope",
        }),
        null,
      ),
    ).toBe("daemon-authentication");
    expect(
      remoteRequestFailureCode(
        "fetch-session-state",
        new EnvironmentOperationForbiddenError({
          code: "operation_forbidden",
          reason: "current_session_revoke_not_allowed",
          traceId: "trace-forbidden",
        }),
        null,
      ),
    ).toBe("daemon-authentication");
  });

  it("classifies descriptor incompatibility as a protocol mismatch", () => {
    expect(
      remoteRequestFailureCode(
        "fetch-environment-descriptor",
        new EnvironmentResourceNotFoundError({
          code: "not_found",
          reason: "thread_not_found",
          traceId: "trace-not-found",
        }),
        null,
      ),
    ).toBe("protocol-mismatch");
    expect(
      remoteRequestFailureCode(
        "fetch-environment-descriptor",
        new EnvironmentRequestInvalidError({
          code: "invalid_request",
          reason: "invalid_command",
          traceId: "trace-invalid",
        }),
        null,
      ),
    ).toBe("protocol-mismatch");
  });

  it("keeps transport failures in the daemon-start category", () => {
    expect(
      remoteRequestFailureCode(
        "fetch-session-state",
        new SshHttpBridgeError({ message: "socket closed" }),
        null,
      ),
    ).toBe("daemon-start");
  });
});

describe("sshRequestErrorStatus", () => {
  it("maps authentication and protocol failures to actionable HTTP statuses", () => {
    expect(
      sshRequestErrorStatus(
        new DesktopSshEnvironmentRequestError({
          operation: "bootstrap-bearer-session",
          cause: new SshHttpBridgeError({ message: "invalid credential" }),
          sshHttpStatus: null,
          failureCode: "daemon-authentication",
        }),
      ),
    ).toBe(401);
    expect(
      sshRequestErrorStatus(
        new DesktopSshEnvironmentRequestError({
          operation: "fetch-environment-descriptor",
          cause: new SshHttpBridgeError({ message: "missing descriptor" }),
          sshHttpStatus: null,
          failureCode: "protocol-mismatch",
        }),
      ),
    ).toBe(409);
    expect(
      sshRequestErrorStatus(
        new DesktopSshEnvironmentRequestError({
          operation: "fetch-session-state",
          cause: new SshHttpBridgeError({ message: "socket closed" }),
          sshHttpStatus: null,
          failureCode: "daemon-start",
        }),
      ),
    ).toBe(502);
  });
});

describe("sshErrorStatus", () => {
  it("maps structured SSH failures to HTTP statuses without parsing messages", () => {
    expect(
      sshErrorStatus(
        new SshHostDiscoveryError({
          message: "SSH host key changed for devbox.",
          cause: null,
        }),
      ),
    ).toBe(409);
    expect(
      sshErrorStatus(new SshPasswordPromptError({ message: "SSH authentication cancelled." })),
    ).toBe(401);
    expect(
      sshErrorStatus(
        new SshCommandError({
          message: "AWEN_ERROR prerequisite-missing Remote host is missing Git on PATH.",
          command: ["ssh", "devbox"],
          exitCode: 1,
          stderr: "AWEN_ERROR prerequisite-missing Remote host is missing Git on PATH.",
        }),
      ),
    ).toBe(422);
  });
});
