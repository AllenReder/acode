import { describe, expect, it } from "@effect/vitest";
import { EnvironmentAuthInvalidError, EnvironmentScopeRequiredError } from "@awen/contracts";
import { RemoteEnvironmentAuthTimeoutError } from "../rpc/http.ts";
import { mapRemoteEnvironmentError } from "./errors.ts";

describe("mapRemoteEnvironmentError", () => {
  it("classifies invalid credentials as an authentication block", () => {
    const mapped = mapRemoteEnvironmentError(
      new EnvironmentAuthInvalidError({
        code: "auth_invalid",
        reason: "invalid_credential",
        traceId: "trace-1",
      }),
    );
    expect(mapped).toMatchObject({ _tag: "ConnectionBlockedError", reason: "authentication" });
  });

  it("classifies missing scopes as a permission block", () => {
    const mapped = mapRemoteEnvironmentError(
      new EnvironmentScopeRequiredError({
        code: "insufficient_scope",
        requiredScope: "orchestration:read",
        traceId: "trace-2",
      }),
    );
    expect(mapped).toMatchObject({ _tag: "ConnectionBlockedError", reason: "permission" });
  });

  it("classifies slow remote requests as transient timeouts", () => {
    const mapped = mapRemoteEnvironmentError(
      new RemoteEnvironmentAuthTimeoutError("https://remote.test", 1_000),
    );
    expect(mapped).toMatchObject({ _tag: "ConnectionTransientError", reason: "timeout" });
  });
});
