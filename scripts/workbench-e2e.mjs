#!/usr/bin/env node
// @effect-diagnostics nodeBuiltinImport:off
import * as NodeAssert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import * as NodeFS from "node:fs/promises";
import * as NodeNet from "node:net";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";
import { chromium } from "playwright";

// This suite never sends an Agent turn. Promotion coverage must use the ACP
// mock agent; a future real-provider smoke must opt in, use gpt-5.6-luna at
// most, and reject gpt-6-astra before sending.
const repositoryRoot = NodePath.resolve(import.meta.dirname, "..");
const timeoutMs = Number(process.env.WORKBENCH_E2E_TIMEOUT_MS ?? "120000");
const keepTemporary = process.env.WORKBENCH_E2E_KEEP_TEMP === "1";

function stripAnsi(value) {
  return value.replace(/\u001b\[[0-9;]*m/g, "");
}

async function chooseContextMenuItem(page, trigger, label) {
  await trigger.click({ button: "right" });
  const item = page.getByRole("button", { name: label, exact: true });
  await item.waitFor({ state: "visible", timeout: timeoutMs });
  // The fallback deliberately ignores clicks from the opening gesture. Wait
  // beyond that guard before issuing the semantic menu selection.
  await page.evaluate(
    () =>
      new Promise((resolve) =>
        requestAnimationFrame(() => requestAnimationFrame(() => resolve(undefined))),
      ),
  );
  await item.click();
}

async function readOpenTerminalTarget(page) {
  return page.evaluate(async () => {
    const { useWorkbenchStore } = await import("/src/workbench/workbenchStore.ts");
    for (const tab of useWorkbenchStore.getState().tabs) {
      for (const view of tab.panes.values()) {
        if (view.target.kind === "workspaceTerminal") return view.target;
      }
    }
    throw new Error("Expected an open Terminal Session View.");
  });
}

async function openTerminalInSecondTab(page, target) {
  return page.evaluate(async (terminalTarget) => {
    const { useWorkbenchStore } = await import("/src/workbench/workbenchStore.ts");
    const store = useWorkbenchStore.getState();
    const firstTabId = store.activeTabId;
    store.createTab();
    useWorkbenchStore.getState().openTarget(terminalTarget);
    return { firstTabId };
  }, target);
}

async function terminalViewCountsByTab(page) {
  return page.evaluate(async () => {
    const { useWorkbenchStore } = await import("/src/workbench/workbenchStore.ts");
    return useWorkbenchStore.getState().tabs.map((tab) => ({
      id: tab.id,
      terminalViews: [...tab.panes.values()].filter(
        (view) => view.target.kind === "workspaceTerminal",
      ).length,
    }));
  });
}

function reservePort() {
  return new Promise((resolve, reject) => {
    const server = NodeNet.createServer();
    server.unref();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      if (address === null || typeof address === "string") {
        server.close();
        reject(new Error("Could not reserve a local port."));
        return;
      }
      const { port } = address;
      server.close((error) => (error ? reject(error) : resolve(port)));
    });
  });
}

function waitForOutput(child, pattern, label) {
  return new Promise((resolve, reject) => {
    let output = "";
    const timer = setTimeout(() => {
      cleanup();
      reject(new Error(`Timed out waiting for ${label}.\n${stripAnsi(output)}`));
    }, timeoutMs);
    const onData = (chunk) => {
      output += chunk.toString();
      const match = stripAnsi(output).match(pattern);
      if (match !== null) {
        cleanup();
        resolve({ match, output });
      }
    };
    const onExit = (code, signal) => {
      cleanup();
      reject(
        new Error(
          `Dev runner exited before ${label}: code=${String(code)} signal=${String(signal)}\n${stripAnsi(output)}`,
        ),
      );
    };
    const cleanup = () => {
      clearTimeout(timer);
      child.stdout.off("data", onData);
      child.stderr.off("data", onData);
      child.off("exit", onExit);
    };
    child.stdout.on("data", onData);
    child.stderr.on("data", onData);
    child.once("exit", onExit);
  });
}

async function stopProcess(child) {
  if (child === null || child.exitCode !== null || child.signalCode !== null) return;
  const exited = new Promise((resolve) => child.once("exit", resolve));
  if (process.platform === "win32") {
    child.kill("SIGTERM");
  } else {
    process.kill(-child.pid, "SIGTERM");
  }
  const killed = await Promise.race([
    exited.then(() => true),
    new Promise((resolve) => setTimeout(() => resolve(false), 5_000)),
  ]);
  if (!killed && process.platform !== "win32") {
    process.kill(-child.pid, "SIGKILL");
    await exited;
  }
}

async function main() {
  const temporaryRoot = await NodeFS.mkdtemp(
    NodePath.join(NodeOS.tmpdir(), "acode-workbench-e2e-"),
  );
  const home = NodePath.join(temporaryRoot, "home");
  await NodeFS.mkdir(home, { recursive: true });

  const serverPort = await reservePort();
  const child = spawn(
    "pnpm",
    [
      "exec",
      "node",
      NodePath.join(repositoryRoot, "scripts/dev-runner.ts"),
      "--home-dir",
      home,
      "--port",
      String(serverPort),
      "--auto-bootstrap-project-from-cwd",
      "dev",
    ],
    {
      cwd: repositoryRoot,
      detached: process.platform !== "win32",
      env: {
        ...process.env,
        CI: "1",
        T3CODE_AUTO_BOOTSTRAP_PROJECT_FROM_CWD: "1",
      },
      stdio: ["ignore", "pipe", "pipe"],
    },
  );

  let browser = null;
  let page = null;
  const pageErrors = [];
  const consoleErrors = [];
  try {
    const { match: pairingMatch } = await waitForOutput(
      child,
      /pairingUrl:\s*(https?:\/\/\S+)/,
      "the isolated daemon pairing URL",
    );
    const pairingUrl = stripAnsi(pairingMatch[1]);
    browser = await chromium.launch({
      headless: process.env.WORKBENCH_E2E_HEADED !== "1",
      ...(process.env.PLAYWRIGHT_USE_SYSTEM_CHROME === "1" ? { channel: "chrome" } : {}),
    });
    const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    await context.addInitScript(() => {
      localStorage.setItem(
        "t3code:client-settings:v1",
        JSON.stringify({ onboardingCompletedAt: new Date().toISOString() }),
      );
    });
    page = await context.newPage();
    page.on("pageerror", (error) => pageErrors.push(error));
    page.on("console", (message) => {
      if (message.type() === "error") consoleErrors.push(message.text());
    });
    await page.goto(pairingUrl, { waitUntil: "domcontentloaded" });

    const addProject = page.getByTestId("sidebar-add-project");
    const workspaceRow = page.getByTestId("sidebar-workspace-row").first();
    await workspaceRow.waitFor({ state: "visible", timeout: timeoutMs });

    await chooseContextMenuItem(page, workspaceRow, "New Agent Session");
    const draftPane = page.locator('[data-pane-target-kind="newAgentSession"]');
    await draftPane.waitFor({ state: "visible", timeout: timeoutMs });
    NodeAssert.match(page.url(), /\/draft\/[^/]+$/);

    const draftUrl = page.url();
    await page.reload({ waitUntil: "domcontentloaded" });
    await page.locator('[data-pane-target-kind="newAgentSession"]').waitFor({
      state: "visible",
      timeout: timeoutMs,
    });
    NodeAssert.equal(page.url(), draftUrl);
    await page
      .locator('[data-testid="sidebar-workspace-row"][data-environment-connected="true"]')
      .first()
      .waitFor({ state: "visible", timeout: timeoutMs });

    await chooseContextMenuItem(
      page,
      page.getByTestId("sidebar-workspace-row").first(),
      "New Terminal Session",
    );
    const terminalPane = page.locator('[data-pane-target-kind="workspaceTerminal"]');
    const terminalCreated = await terminalPane
      .waitFor({ state: "visible", timeout: 5_000 })
      .then(() => true)
      .catch(() => false);
    if (!terminalCreated) {
      throw new Error(
        `Terminal Session did not open. Visible text:\n${(await page.locator("body").innerText()).slice(0, 8_000)}`,
      );
    }
    NodeAssert.equal(await page.locator("[data-pane-id]").count(), 2);
    NodeAssert.match(page.url(), /\/terminal-sessions\//);
    const terminalTarget = await readOpenTerminalTarget(page);

    const panes = page.locator("[data-pane-id]");
    const before = await panes.evaluateAll((elements) =>
      elements.map((element) => {
        const rect = element.getBoundingClientRect();
        return { kind: element.getAttribute("data-pane-target-kind"), width: rect.width };
      }),
    );
    const separator = page.locator("[data-sash-id]").first();
    const separatorBox = await separator.boundingBox();
    NodeAssert.ok(separatorBox !== null, "Expected a visible BSP separator.");
    const separatorHit = await separator.evaluate((element) => {
      const rect = element.getBoundingClientRect();
      const hit = document.elementFromPoint(
        rect.left + rect.width / 2,
        rect.top + rect.height / 2,
      );
      return hit?.closest("[data-sash-id]")?.getAttribute("data-sash-id") ?? null;
    });
    NodeAssert.equal(
      separatorHit,
      await separator.getAttribute("data-sash-id"),
      "The BSP separator must render on top of the pane boundary.",
    );
    await page.mouse.move(separatorBox.x + separatorBox.width / 2, separatorBox.y + 80);
    await page.mouse.down();
    await page.mouse.move(separatorBox.x + separatorBox.width / 2 + 120, separatorBox.y + 80, {
      steps: 8,
    });
    await page.mouse.up();
    const after = await panes.evaluateAll((elements) =>
      elements.map((element) => {
        const rect = element.getBoundingClientRect();
        return { kind: element.getAttribute("data-pane-target-kind"), width: rect.width };
      }),
    );
    NodeAssert.notDeepEqual(
      after.map((pane) => pane.width),
      before.map((pane) => pane.width),
      "Dragging the BSP separator must resize the two panes.",
    );

    await draftPane.getByRole("button", { name: "Close pane" }).click();
    await NodeAssert.rejects(
      draftPane.waitFor({ state: "visible", timeout: 1_000 }),
      /Timeout|detached|hidden/i,
    );
    NodeAssert.equal(await page.locator('[data-pane-target-kind="workspaceTerminal"]').count(), 1);

    await chooseContextMenuItem(
      page,
      page.getByTestId("sidebar-workspace-row").first(),
      "New Agent Session",
    );
    await page.locator('[data-pane-target-kind="newAgentSession"]').waitFor({
      state: "visible",
      timeout: timeoutMs,
    });

    const { firstTabId } = await openTerminalInSecondTab(page, terminalTarget);
    await page.locator('[data-pane-target-kind="workspaceTerminal"]').waitFor({
      state: "visible",
      timeout: timeoutMs,
    });
    NodeAssert.deepEqual(
      (await terminalViewCountsByTab(page)).map((tab) => tab.terminalViews),
      [1, 1],
      "The same Terminal Session should be open once in each internal Tab.",
    );

    await page.getByTestId("sidebar-workspace-disclosure").first().click();
    const terminalSessionRow = page
      .locator('[data-testid="sidebar-session-row"][data-session-kind="terminal"]')
      .first();
    await terminalSessionRow.waitFor({ state: "visible", timeout: timeoutMs });
    await chooseContextMenuItem(page, terminalSessionRow, "Close session");
    await page.locator('[data-pane-target-kind="workspaceTerminal"]').waitFor({
      state: "detached",
      timeout: timeoutMs,
    });
    NodeAssert.deepEqual(
      (await terminalViewCountsByTab(page)).map((tab) => tab.terminalViews),
      [0, 0],
      "closeSession must remove the Terminal View from every internal Tab.",
    );
    await page.evaluate(async (tabId) => {
      const { useWorkbenchStore } = await import("/src/workbench/workbenchStore.ts");
      useWorkbenchStore.getState().activateTab(tabId);
    }, firstTabId);
    await page.locator('[data-pane-target-kind="newAgentSession"]').waitFor({
      state: "visible",
      timeout: timeoutMs,
    });
    await page.getByTestId("sidebar-history-toggle").first().waitFor({
      state: "visible",
      timeout: timeoutMs,
    });

    await page.getByTestId("sidebar-history-toggle").first().click();
    const closedTerminalRow = page
      .locator(
        '[data-testid="sidebar-session-row"][data-session-kind="terminal"][data-session-closed="true"]',
      )
      .first();
    await closedTerminalRow.waitFor({ state: "visible", timeout: timeoutMs });
    await chooseContextMenuItem(page, closedTerminalRow, "Delete session");
    await page.getByRole("button", { name: "Confirm", exact: true }).click();
    await closedTerminalRow.waitFor({ state: "detached", timeout: timeoutMs });

    page.once("dialog", (dialog) => void dialog.accept());
    await chooseContextMenuItem(
      page,
      page.getByTestId("sidebar-project-row").first(),
      "Remove project",
    );
    await page.getByTestId("sidebar-project-row").first().waitFor({
      state: "detached",
      timeout: timeoutMs,
    });
    await page.getByText("Welcome to ACode", { exact: true }).waitFor({ timeout: timeoutMs });
    NodeAssert.equal(await page.locator("[data-pane-id]").count(), 1);
    NodeAssert.deepEqual(pageErrors, []);

    await addProject.waitFor({ state: "visible", timeout: timeoutMs });
    console.log(
      "workbench E2E passed: draft reload, Agent+Terminal split, resize, closeView, cross-Tab closeSession, Delete, remove project",
    );
  } catch (error) {
    console.error(`Browser page errors: ${pageErrors.map(String).join("\n")}`);
    console.error(`Browser console errors: ${consoleErrors.join("\n")}`);
    if (page !== null) {
      const screenshotPath = NodePath.join(temporaryRoot, "failure.png");
      await page.screenshot({ path: screenshotPath, fullPage: true }).catch(() => undefined);
      console.error(`Workbench E2E failure screenshot: ${screenshotPath}`);
      console.error(
        (
          await page
            .locator("body")
            .innerText()
            .catch(() => "")
        ).slice(0, 12_000),
      );
    }
    throw error;
  } finally {
    await browser?.close();
    await stopProcess(child);
    if (!keepTemporary) {
      await NodeFS.rm(temporaryRoot, { recursive: true, force: true });
    } else {
      console.log(`kept workbench E2E data at ${temporaryRoot}`);
    }
  }
}

await main();
