import * as NodeAssert from "node:assert/strict";
import * as NodeFSP from "node:fs/promises";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";
import * as NodeURL from "node:url";
import { chromium, webkit } from "playwright";
import { build } from "vite-plus";

// Exercise the production Ghostty loader under the checked-in desktop CSP.
// Use a non-loopback origin so the daemon's localhost allowlist cannot mask
// a missing 'self' source. All requests are fulfilled locally by Playwright.
const root = NodeURL.fileURLToPath(new URL("../", import.meta.url));
const config = JSON.parse(
  await NodeFSP.readFile(NodePath.join(root, "apps/desktop/src-tauri/tauri.conf.json"), "utf8"),
);
const devConfig = JSON.parse(
  await NodeFSP.readFile(NodePath.join(root, "apps/desktop/src-tauri/tauri.dev.conf.json"), "utf8"),
);
const devSecurity = { ...config.app.security, ...devConfig.app?.security };
const engine = process.argv.includes("--webkit") ? webkit : chromium;
const directory = await NodeFSP.mkdtemp(NodePath.join(NodeOS.tmpdir(), "acode-desktop-terminal-"));
let browser;

try {
  await build({
    configFile: false,
    root: NodePath.join(root, "apps/web"),
    logLevel: "error",
    build: {
      outDir: directory,
      emptyOutDir: true,
      rollupOptions: {
        input: NodePath.join(root, "apps/web/src/terminal/ghostty/runtime.ts"),
        preserveEntrySignatures: "strict",
        output: { entryFileNames: "runtime.js" },
      },
    },
  });
  browser = await engine.launch({ headless: true });
  for (const [label, policy] of [
    ["packaged", devSecurity.csp],
    ["development", devSecurity.devCsp ?? devSecurity.csp],
  ]) {
    const page = await browser.newPage();
    const errors = [];
    page.on("console", (message) => {
      if (message.type() === "error") errors.push(message.text());
    });
    await page.route("**/*", async (route) => {
      const url = new URL(route.request().url());
      NodeAssert.equal(
        url.origin,
        "http://acode.test",
        "The smoke must not access remote services",
      );
      if (url.pathname === "/") {
        await route.fulfill({
          contentType: "text/html",
          headers: { "Content-Security-Policy": policy },
          body: '<script type="module" src="/entry.js"></script>',
        });
      } else if (url.pathname === "/entry.js") {
        await route.fulfill({
          contentType: "application/javascript",
          body: `import { loadGhosttyRuntime } from './runtime.js';
            try {
              const runtime = await loadGhosttyRuntime();
              let permitsJavaScriptEval = false;
              try { permitsJavaScriptEval = (0, eval)('1 + 1') === 2; } catch {}
              window.result = { ok: true, hasMemory: runtime.memory.buffer.byteLength > 0, permitsJavaScriptEval };
            } catch (error) {
              window.result = { ok: false, error: String(error) };
            }`,
        });
      } else {
        const file = NodePath.resolve(directory, `.${url.pathname}`);
        NodeAssert.ok(file.startsWith(`${directory}${NodePath.sep}`));
        await route.fulfill({
          contentType: file.endsWith(".wasm") ? "application/wasm" : "application/javascript",
          body: await NodeFSP.readFile(file),
        });
      }
    });
    await page.goto("http://acode.test/");
    await page.waitForFunction(() => window.result !== undefined, undefined, { timeout: 10_000 });
    const result = await page.evaluate(() => window.result);
    NodeAssert.equal(result.ok, true, `${label}: ${result.error}\n${errors.join("\n")}`);
    NodeAssert.equal(result.hasMemory, true, `${label}: Ghostty must allocate real WASM memory`);
    if (label === "packaged") {
      NodeAssert.equal(
        result.permitsJavaScriptEval,
        false,
        "Packaged JavaScript eval must remain blocked",
      );
    }
    console.log(`${engine.name()} ${label}: Ghostty WASM and PTY trampoline initialized`);
    await page.close();
  }
} finally {
  await browser?.close();
  await NodeFSP.rm(directory, { recursive: true, force: true });
}
