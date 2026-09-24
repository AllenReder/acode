import { describe, expect, it } from "vite-plus/test";

import { verifyServerReleaseInputs } from "./verify-server-release-inputs.ts";

const PRODUCT_VERSION = "0.1.0-alpha.1";

describe("verifyServerReleaseInputs", () => {
  it("accepts a tag matching the shared product and server versions", () => {
    expect(
      verifyServerReleaseInputs({
        version: PRODUCT_VERSION,
        tag: `v${PRODUCT_VERSION}`,
        productVersion: PRODUCT_VERSION,
        serverVersion: PRODUCT_VERSION,
      }),
    ).toEqual([]);
  });

  it("rejects tags and package versions that drift from the shared release", () => {
    expect(
      verifyServerReleaseInputs({
        version: PRODUCT_VERSION,
        tag: "v0.1.0-alpha.2",
        productVersion: PRODUCT_VERSION,
        serverVersion: PRODUCT_VERSION,
      }),
    ).toContain("SSH installation requires the release tag v0.1.0-alpha.1.");
    expect(
      verifyServerReleaseInputs({
        version: PRODUCT_VERSION,
        tag: `v${PRODUCT_VERSION}`,
        productVersion: PRODUCT_VERSION,
        serverVersion: "0.1.0-alpha.2",
      }),
    ).toContain(
      "Version 0.1.0-alpha.1 does not match the checked-out daemon version 0.1.0-alpha.2.",
    );
  });

  it("rejects versions that are not valid SemVer", () => {
    expect(
      verifyServerReleaseInputs({
        version: "0.1.0-alpha.01",
        productVersion: PRODUCT_VERSION,
        serverVersion: PRODUCT_VERSION,
      }),
    ).toContain("Version must be an exact semver-like value, not latest or a dist-tag.");
  });
});
