import { describe, expect, it } from "vite-plus/test";

import { isSafeExternalUrl } from "./tauriBridge";

describe("Tauri desktop external-link boundary", () => {
  it("only permits ordinary HTTP(S) URLs without embedded credentials", () => {
    expect(isSafeExternalUrl("https://example.com/docs")).toBe(true);
    expect(isSafeExternalUrl("http://localhost:3773/pair")).toBe(true);

    expect(isSafeExternalUrl("javascript:alert(1)")).toBe(false);
    expect(isSafeExternalUrl("data:text/html,<script>alert(1)</script>")).toBe(false);
    expect(isSafeExternalUrl("file:///etc/passwd")).toBe(false);
    expect(isSafeExternalUrl("https://user:password@example.com")).toBe(false);
    expect(isSafeExternalUrl("not a URL")).toBe(false);
  });
});
