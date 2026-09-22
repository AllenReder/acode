import { describe, expect, it, vi } from "vite-plus/test";

import { createDesktopSshApiClient, isSafeExternalUrl } from "./tauriBridge";

describe("Tauri desktop SSH API client", () => {
  it("sends the local daemon bearer token and JSON body", async () => {
    const fetchMock = vi.fn().mockResolvedValue(Response.json({ ok: true }));
    const client = createDesktopSshApiClient({
      getBaseUrl: () => "http://127.0.0.1:3773/",
      getBearerToken: async () => "local-token",
      fetchFn: fetchMock,
    });

    await expect(
      client.request("/api/desktop/ssh/hosts/resolve", {
        method: "POST",
        body: { alias: "devbox" },
      }),
    ).resolves.toEqual({ ok: true });

    const [url, init] = fetchMock.mock.calls[0]!;
    expect(String(url)).toBe("http://127.0.0.1:3773/api/desktop/ssh/hosts/resolve");
    expect(init?.method).toBe("POST");
    expect(new Headers(init?.headers).get("authorization")).toBe("Bearer local-token");
    expect(new Headers(init?.headers).get("content-type")).toBe("application/json");
    expect(init?.body).toBe(JSON.stringify({ alias: "devbox" }));
  });

  it("preserves daemon error messages", async () => {
    const client = createDesktopSshApiClient({
      getBaseUrl: () => "http://127.0.0.1:3773/",
      getBearerToken: async () => "local-token",
      fetchFn: vi.fn().mockResolvedValue(
        Response.json(
          { error: { message: "SSH authentication cancelled." } },
          { status: 401 },
        ),
      ),
    });

    await expect(client.request("/api/desktop/ssh/ensure", { method: "POST" })).rejects.toThrow(
      "SSH authentication cancelled.",
    );
  });
});

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
