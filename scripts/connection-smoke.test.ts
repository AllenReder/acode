import { describe, expect, it } from "vite-plus/test";

import { parseServerReadyOutput } from "./connection-smoke.ts";

describe("connection smoke readiness", () => {
  it("waits for both the connection string and pairing token", () => {
    expect(parseServerReadyOutput("Connection string: http://127.0.0.1:1234\n")).toBeUndefined();
    expect(parseServerReadyOutput("Token: short-token\n")).toBeUndefined();
  });

  it("extracts the server access details from the headless output", () => {
    expect(
      parseServerReadyOutput(
        [
          "Migrations ran successfully",
          "Connection string: http://127.0.0.1:1234",
          "Token: pairing-token",
          "Pairing URL: http://127.0.0.1:1234/pair#token=pairing-token",
        ].join("\n"),
      ),
    ).toEqual({
      connectionString: "http://127.0.0.1:1234",
      token: "pairing-token",
    });
  });
});
