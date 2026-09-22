import * as NodeAssert from "node:assert/strict";

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
  console.log("appearance: settings scroll and text selection");
  await page.goto(new URL("/settings/appearance", page.url()).toString(), {
    waitUntil: "domcontentloaded",
  });
  await page.getByRole("slider", { name: "Sidebar opacity", exact: true }).waitFor();
  const scroll = page.locator("[data-settings-page-scroll]");
  await scroll.waitFor();
  console.log("appearance: settings opened");
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
  const description = page.getByText("Translucency of the full-height navigation sidebar.", {
    exact: true,
  });
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

  console.log(
    "settings scrolling and selection checks passed; native glass and dragging require macOS",
  );
}
