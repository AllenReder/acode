import * as NodeAssert from "node:assert/strict";

async function paintedPixel(page, x, y) {
  const png = await page.screenshot();
  return page.evaluate(
    async ({ png, x, y }) => {
      const image = new Image();
      image.src = `data:image/png;base64,${png}`;
      await image.decode();
      const canvas = document.createElement("canvas");
      canvas.width = image.width;
      canvas.height = image.height;
      const ctx = canvas.getContext("2d");
      ctx.drawImage(image, 0, 0);
      return [...ctx.getImageData(x, y, 1, 1).data].slice(0, 3);
    },
    { png: png.toString("base64"), x, y },
  );
}

export async function verifyTerminalMaterial(page) {
  console.log("terminal: real renderer transparency");
  await page.evaluate(async () => {
    const { XtermTerminalSurface } = await import("/src/terminal/xterm/surface.ts");
    const { buildXtermTheme } = await import("/src/terminal/xterm/theme.ts");
    const mount = document.createElement("div");
    mount.id = "terminal-material-probe";
    mount.style.cssText =
      "position:fixed;left:0;top:0;width:400px;height:240px;z-index:99999;background:rgb(80,120,160)";
    document.body.append(mount);
    window.__terminalMaterialReplies = [];
    window.__terminalMaterialProbe = await XtermTerminalSurface.create(mount, {
      theme: buildXtermTheme({
        background: "#101010",
        foreground: "#eeeeee",
        cursor: "#eeeeee",
        isDark: true,
      }),
      font: { family: "monospace", size: 16 },
      topFade: true,
      onData: (data) => window.__terminalMaterialReplies.push(data),
      onResize: () => {},
    });
  });
  await page.waitForTimeout(100);
  NodeAssert.deepEqual(
    await paintedPixel(page, 300, 100),
    [80, 120, 160],
    "Default terminal cells must reveal their containing material",
  );
  await page.evaluate(async () => {
    const { buildXtermTheme } = await import("/src/terminal/xterm/theme.ts");
    window.__terminalMaterialProbe.setTheme(
      buildXtermTheme({
        background: "#ffffff",
        foreground: "#222222",
        cursor: "#222222",
        isDark: false,
      }),
    );
    window.__terminalMaterialProbe.write("\x1b]11;?\x07");
  });
  await page.waitForFunction(() =>
    window.__terminalMaterialReplies.some((data) => data.includes("]11;rgb:")),
  );
  NodeAssert.deepEqual(
    await paintedPixel(page, 300, 100),
    [80, 120, 160],
    "Changing theme must preserve transparent default cells",
  );
  await page.evaluate(() => window.__terminalMaterialProbe.write("\x1b[41m\x1b[2J"));
  await page.waitForTimeout(100);
  NodeAssert.notDeepEqual(
    await paintedPixel(page, 300, 100),
    [80, 120, 160],
    "Explicit ANSI backgrounds must still paint",
  );
  await page.evaluate(() =>
    window.__terminalMaterialProbe.write("\x1b[0m\x1b[2J\x1b[H" + "history\r\n".repeat(80)),
  );
  const screen = page.locator("#terminal-material-probe .xterm-screen");
  await page.waitForFunction(
    () =>
      getComputedStyle(document.querySelector("#terminal-material-probe .xterm-screen"))
        .maskImage !== "none",
  );
  await screen.hover();
  await page.mouse.wheel(0, -1200);
  await page.waitForFunction(() => !window.__terminalMaterialProbe.isAtBottom());
  // Drag the actual thumb to both endpoints; wheel events are intentionally
  // normalized by xterm, so an arbitrary large delta is not "scroll to top".
  const track = await page.locator("#terminal-material-probe .scrollbar.vertical").boundingBox();
  const thumb = await page
    .locator("#terminal-material-probe .scrollbar.vertical .slider")
    .boundingBox();
  await page.mouse.move(thumb.x + thumb.width / 2, thumb.y + thumb.height / 2);
  await page.mouse.down();
  await page.mouse.move(thumb.x + thumb.width / 2, track.y + thumb.height / 2, { steps: 8 });
  await page.mouse.up();
  await page.waitForFunction(
    () =>
      getComputedStyle(document.querySelector("#terminal-material-probe .xterm-screen"))
        .maskImage === "none",
  );
  const topThumb = await page
    .locator("#terminal-material-probe .scrollbar.vertical .slider")
    .boundingBox();
  await page.mouse.move(topThumb.x + topThumb.width / 2, topThumb.y + topThumb.height / 2);
  await page.mouse.down();
  await page.mouse.move(
    topThumb.x + topThumb.width / 2,
    track.y + track.height - topThumb.height / 2,
    { steps: 8 },
  );
  await page.mouse.up();
  await page.waitForFunction(
    () =>
      getComputedStyle(document.querySelector("#terminal-material-probe .xterm-screen"))
        .maskImage !== "none",
  );
  await page.evaluate(() => window.__terminalMaterialProbe.write("\x1b[?1049h"));
  await page.waitForFunction(
    () =>
      getComputedStyle(document.querySelector("#terminal-material-probe .xterm-screen"))
        .maskImage === "none",
  );
  await page.evaluate(() => window.__terminalMaterialProbe.write("\x1b[?1049l\x1b[H"));
  await page.waitForTimeout(100);
  NodeAssert.equal(
    await screen.evaluate((el) => getComputedStyle(el).maskImage),
    "none",
    "A prompt in the top row must remain visible",
  );
  // WebGL context loss exercises the production renderer fallback.
  await page.evaluate(() => {
    const canvas = document.querySelector("#terminal-material-probe canvas:not(.xterm-link-layer)");
    window.__lostWebglCanvas = canvas;
    canvas?.getContext("webgl2")?.getExtension("WEBGL_lose_context")?.loseContext();
    window.__terminalMaterialProbe.write("\x1b[0m\x1b[2J");
  });
  await page.waitForFunction(() => !window.__lostWebglCanvas?.isConnected);
  await page.waitForTimeout(100);
  NodeAssert.deepEqual(
    await paintedPixel(page, 300, 100),
    [80, 120, 160],
    "Renderer fallback must keep the material visible",
  );
  await page.evaluate(() => {
    window.__terminalMaterialProbe.dispose();
    document.getElementById("terminal-material-probe").remove();
  });
}
