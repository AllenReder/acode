import { beforeEach, describe, expect, it, vi } from "vite-plus/test";

const { confirmMock, ensureLocalApiMock } = vi.hoisted(() => ({
  confirmMock: vi.fn<(message: string, options?: unknown) => Promise<boolean>>(),
  ensureLocalApiMock: vi.fn(),
}));

vi.mock("../localApi", () => ({
  ensureLocalApi: ensureLocalApiMock,
}));

import { requestDestructiveConfirmation } from "./destructiveConfirmation";

describe("requestDestructiveConfirmation", () => {
  beforeEach(() => {
    confirmMock.mockReset();
    ensureLocalApiMock.mockReset();
    ensureLocalApiMock.mockReturnValue({ dialogs: { confirm: confirmMock } });
  });

  it("uses the destructive shared confirmation and returns the user's decision", async () => {
    confirmMock.mockResolvedValue(false);

    await expect(
      requestDestructiveConfirmation({
        message: "Remove this Workspace?",
        onFailure: vi.fn(),
      }),
    ).resolves.toBe(false);

    expect(confirmMock).toHaveBeenCalledWith("Remove this Workspace?", {
      variant: "destructive",
    });
  });

  it("reports dialog failures and fails closed", async () => {
    const failure = new Error("dialog unavailable");
    const onFailure = vi.fn();
    confirmMock.mockRejectedValue(failure);

    await expect(
      requestDestructiveConfirmation({
        message: "Delete this Workspace?",
        onFailure,
      }),
    ).resolves.toBe(false);

    expect(onFailure).toHaveBeenCalledWith(failure);
  });
});
