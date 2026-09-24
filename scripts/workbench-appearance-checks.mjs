import * as NodeAssert from "node:assert/strict";
import {
  paintedPixel,
  verifyTerminalMaterial,
  verifyTerminalSessionMaterial,
} from "./terminal-material-checks.mjs";

async function dragSelect(page, locator) {
  await locator.scrollIntoViewIfNeeded();
  const box = await locator.boundingBox();
  NodeAssert.ok(box);
  await page.evaluate(() => window.getSelection()?.removeAllRanges());
  await page.mouse.move(box.x + 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width - 2, box.y + box.height / 2, { steps: 12 });
  await page.mouse.up();
  return page.evaluate(() => window.getSelection()?.toString() ?? "");
}

/** Real DOM/layout and pointer checks. Native composition still needs a Mac. */
export async function verifyWorkbenchAppearance(page) {
  page.setDefaultTimeout(30_000);
  await page.addLocatorHandler(
    page.getByRole("button", { name: "Dismiss notification", exact: true }).first(),
    async (dismiss) => {
      await dismiss.click();
    },
  );
  await verifySidebarMaterialEdge(page);
  await verifyTerminalMaterial(page);
  await verifyTerminalSessionMaterial(page);
  const workingTopbar = await page
    .locator("[data-workbench-window-chrome]:not(html)")
    .boundingBox();
  const sidebar = await page.locator("[data-app-sidebar]").boundingBox();
  const firstTab = await page.getByRole("tab").first().boundingBox();
  NodeAssert.ok(
    Math.abs(firstTab.x - sidebar.x - sidebar.width) <= 1,
    "Expanded Sidebar must meet the first Tab without a spacer",
  );
  const switcher = page.getByRole("group", { name: "Tab layout" });
  await page.getByRole("button", { name: "Scrolling layout", exact: true }).click();
  await page.waitForFunction(
    () =>
      new DOMMatrix(
        getComputedStyle(document.querySelector('[aria-label="Tab layout"]'), "::before").transform,
      ).m41 === 30,
  );
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.getByRole("button", { name: "BSP layout", exact: true }).click();
  NodeAssert.equal(
    await switcher.evaluate((el) => getComputedStyle(el, "::before").transitionDuration),
    "0s",
  );
  await page.emulateMedia({ reducedMotion: "no-preference" });
  console.log("appearance: settings scroll and text selection");
  await page.goto(new URL("/settings/appearance", page.url()).toString(), {
    waitUntil: "domcontentloaded",
  });
  const sidebarOpacity = page.getByRole("slider", { name: "Sidebar opacity", exact: true });
  const nativeGlassSupported = (await sidebarOpacity.count()) > 0;
  if (!nativeGlassSupported) {
    await page.getByText("Unsupported on this platform", { exact: true }).waitFor();
    await verifyOpaqueMaterialHierarchy(page);
  } else {
    await sidebarOpacity.waitFor();
  }
  const scroll = page.locator("[data-settings-page-scroll]");
  await scroll.waitFor();
  console.log("appearance: settings opened");
  const breadcrumb = page.getByRole("navigation", { name: "Settings breadcrumb" });
  const settingsTopbar = breadcrumb.locator('xpath=ancestor::*[@data-material-surface="topbar"]');
  const settingsBox = await settingsTopbar.boundingBox();
  NodeAssert.equal(
    settingsBox.height,
    workingTopbar.height,
    "Settings and working Topbars must have equal height",
  );
  const toggle = page.getByRole("button", { name: "Toggle main sidebar", exact: true });
  await toggle.click();
  await page.waitForTimeout(400);
  const collapsedBreadcrumb = await breadcrumb.boundingBox();
  const back = await page
    .getByRole("button", { name: "Back to workspace", exact: true })
    .boundingBox();
  NodeAssert.ok(
    collapsedBreadcrumb.x > back.x + back.width,
    "Collapsed Settings navigation must clear the Back control",
  );
  await toggle.click();
  await page.waitForTimeout(400);

  const dimensions = await scroll.evaluate((el) => ({
    height: el.clientHeight,
    content: el.scrollHeight,
  }));
  NodeAssert.ok(dimensions.height > 0 && dimensions.content > dimensions.height);
  await scroll.hover();
  await page.mouse.wheel(0, 100000);
  await page.waitForFunction(() => {
    const el = document.querySelector("[data-settings-page-scroll]");
    return el && el.scrollTop > 0 && Math.abs(el.scrollHeight - el.clientHeight - el.scrollTop) < 2;
  });
  console.log("appearance: scrolled to the last setting");
  const description = page.getByText(
    nativeGlassSupported
      ? "Translucency of the full-height navigation sidebar."
      : "Adjust the contrast of colors and borders across the interface.",
    { exact: true },
  );
  NodeAssert.equal(
    await dragSelect(page, description),
    "",
    "Settings descriptions must not select text",
  );
  const search = page.getByRole("combobox", { name: "Search settings", exact: true });
  await search.fill("selectable input");
  await search.selectText();
  NodeAssert.equal(
    await search.evaluate((el) => el.value.slice(el.selectionStart, el.selectionEnd)),
    "selectable input",
  );
  await search.fill("");

  console.log("appearance: selection boundaries passed");
  if (!nativeGlassSupported) {
    console.log(
      "appearance: opaque material hierarchy verified; native glass controls unavailable",
    );
    return;
  }
  const mask = page.getByRole("slider", { name: "Background mask strength", exact: true });
  for (const [mode, defaultMask] of [
    ["light", "10"],
    ["dark", "35"],
  ]) {
    console.log(`appearance: ${mode} mask and colors`);
    await page.getByRole("button", { name: `Use ${mode} mode`, exact: true }).click();
    await page.waitForFunction(
      (mode) => document.documentElement.classList.contains("dark") === (mode === "dark"),
      mode,
    );
    NodeAssert.equal(await mask.inputValue(), defaultMask);
    const color = await description.evaluate((el) => {
      const canvas = document.createElement("canvas");
      canvas.width = canvas.height = 1;
      const ctx = canvas.getContext("2d");
      ctx.fillStyle = getComputedStyle(el).color;
      ctx.fillRect(0, 0, 1, 1);
      return ctx.getImageData(0, 0, 1, 1).data[0];
    });
    NodeAssert.ok(
      mode === "dark" ? color > 200 : color < 100,
      `${mode} secondary text must use the matching palette`,
    );
    await mask.focus();
    await mask.press("End");
    await mask.press("ArrowLeft");
    NodeAssert.equal(await mask.inputValue(), "99");
  }
  await page.getByRole("button", { name: "Use light mode", exact: true }).click();
  NodeAssert.equal(await mask.inputValue(), "99", "Mode-specific mask values must be retained");
  await page
    .getByRole("button", { name: "Reset background mask strength to default", exact: true })
    .click();
  NodeAssert.equal(await mask.inputValue(), "10");
  await page.getByRole("button", { name: "Use dark mode", exact: true }).click();
  NodeAssert.equal(await mask.inputValue(), "99", "Resetting light must not reset dark");
  await page
    .getByRole("button", { name: "Reset background mask strength to default", exact: true })
    .click();
  NodeAssert.equal(await mask.inputValue(), "35");

  console.log(
    "settings scrolling and selection checks passed; native glass and dragging require macOS",
  );
}

/** The opaque fallback must not collapse all four regions into one solid plane. */
async function verifyOpaqueMaterialHierarchy(page) {
  for (const mode of ["light", "dark"]) {
    await page.getByRole("button", { name: `Use ${mode} mode`, exact: true }).click();
    await page.waitForFunction(
      (mode) => document.documentElement.classList.contains("dark") === (mode === "dark"),
      mode,
    );
    const colors = await page.evaluate(() => {
      const root = document.documentElement;
      const probes = ["sidebar", "topbar", "workbench", "overlay"].map((kind) => {
        const probe = document.createElement("div");
        probe.className = `material-surface-${kind}`;
        probe.style.position = "fixed";
        probe.style.inset = "-100px auto auto -100px";
        probe.style.width = "1px";
        probe.style.height = "1px";
        document.body.append(probe);
        const backgroundColor = getComputedStyle(probe).backgroundColor;
        probe.remove();
        return { backgroundColor, kind };
      });
      return {
        opaque: root.classList.contains("material-stage-opaque"),
        stage: getComputedStyle(document.body).backgroundColor,
        surfaces: probes,
      };
    });

    NodeAssert.equal(colors.opaque, true, "The web fallback must use the opaque material stage");
    NodeAssert.notEqual(colors.stage, "", "The opaque stage must paint a background");
    const uniqueColors = new Set(colors.surfaces.map((surface) => surface.backgroundColor));
    NodeAssert.equal(
      uniqueColors.size,
      4,
      `The four ${mode} opaque material regions must stay distinct: ${JSON.stringify(colors)}`,
    );
  }
}

/** A bright backing exposes gaps that the opaque Linux fallback conceals. */
async function verifySidebarMaterialEdge(page) {
  const saved = await page.evaluate(() => {
    const root = document.documentElement;
    const saved = {
      classes: root.className,
      style: root.getAttribute("style"),
      bodyStyle: document.body.getAttribute("style"),
    };
    document.body.style.backgroundColor = "";
    root.classList.remove("material-stage-opaque");
    root.classList.add("dark", "material-stage-native");
    root.style.setProperty("background", "white", "important");
    root.style.setProperty("--material-sidebar-opacity", "0.5");
    root.style.setProperty("--material-background-mask-dark-opacity", "0.35");
    return saved;
  });
  try {
    await page.mouse.move(1000, 450);
    const box = await page.locator("[data-app-sidebar]").boundingBox();
    const edgeX = Math.round(box.x + box.width) - 1;
    const y = Math.round(box.y + box.height * 0.75);
    const interior = await paintedPixel(page, edgeX - 3, y);
    const edge = await paintedPixel(page, edgeX, y);
    NodeAssert.ok(interior[0] > 40, "The fixture must expose a bright backing through the Sidebar");
    NodeAssert.ok(
      edge.every((value, index) => value <= interior[index]),
      `The resting dark Sidebar edge must not become a bright gap: edge=${edge}, interior=${interior}`,
    );
  } finally {
    await page.evaluate((saved) => {
      if (saved.bodyStyle === null) document.body.removeAttribute("style");
      else document.body.setAttribute("style", saved.bodyStyle);
      document.documentElement.className = saved.classes;
      if (saved.style === null) document.documentElement.removeAttribute("style");
      else document.documentElement.setAttribute("style", saved.style);
    }, saved);
  }
}
