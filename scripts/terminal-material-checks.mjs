import * as NodeAssert from "node:assert/strict";

export async function paintedPixel(page, x, y) {
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
    const create = () =>
      XtermTerminalSurface.create(mount, {
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
    const cancelled = await create();
    window.__terminalMaterialProbe = await create();
    cancelled.dispose();
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
  NodeAssert.ok(
    await page.evaluate(() =>
      window.__terminalMaterialReplies.includes("\x1b]11;rgb:ffff/ffff/ffff\x1b\\"),
    ),
    "Background queries must report the light palette RGB while its canvas stays transparent",
  );
  NodeAssert.deepEqual(
    await paintedPixel(page, 300, 100),
    [80, 120, 160],
    "Changing theme must preserve transparent default cells",
  );
  await page.evaluate(() => window.__terminalMaterialProbe.write("\x1b]11;#000000\x07"));
  await page.waitForTimeout(100);
  NodeAssert.deepEqual(
    await paintedPixel(page, 300, 100),
    [80, 120, 160],
    "A program changing the default background must not hide the material",
  );
  await page.evaluate(() => {
    const probe = window.__terminalMaterialProbe;
    probe.resetAndWrite("\x1b]10;#112233;#000000;#445566\x1b\\回放");
  });
  await page.waitForTimeout(100);
  NodeAssert.deepEqual(
    await paintedPixel(page, 300, 100),
    [80, 120, 160],
    "History replay must preserve transparent default cells",
  );
  await page.evaluate(() => {
    const probe = window.__terminalMaterialProbe;
    const bytes = new TextEncoder().encode("\x1b]11;#000000\x1b\\中文");
    for (const byte of bytes) probe.write(new Uint8Array([byte]));
    probe.write("\x1b]10;?;?;?\x07");
  });
  await page.waitForFunction(() =>
    window.__terminalMaterialReplies.includes("\x1b]12;rgb:4444/5555/6666\x1b\\"),
  );
  NodeAssert.ok(
    await page.evaluate(() =>
      window.__terminalMaterialReplies.includes("\x1b]10;rgb:1111/2222/3333\x1b\\"),
    ),
    "Combined foreground/background/cursor commands must preserve foreground and cursor colors",
  );
  NodeAssert.deepEqual(
    await paintedPixel(page, 300, 100),
    [80, 120, 160],
    "Chunked PTY setters must preserve transparent default cells",
  );
  for (const sequence of ["\x1bPqdata\x1b]11;#000000\x07", "\x1b]0000000011;#000000\x07"]) {
    await page.evaluate((data) => window.__terminalMaterialProbe.write(data), sequence);
    await page.waitForTimeout(100);
    NodeAssert.deepEqual(
      await paintedPixel(page, 300, 100),
      [80, 120, 160],
      "Interrupted control strings and leading-zero OSC identifiers must preserve transparency",
    );
  }
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

/** Exercise the ordinary Session/PTY path as well as the isolated renderer. */
export async function verifyTerminalSessionMaterial(page) {
  console.log("terminal: new shell Session and history replay");
  await page.getByTestId("sidebar-workspace-row").first().click({ button: "right" });
  const createTerminal = page.getByRole("button", { name: "New Terminal Session", exact: true });
  await createTerminal.waitFor();
  await page.waitForTimeout(100);
  await createTerminal.click();
  const pane = page.locator('[data-pane-target-kind="workspaceTerminal"]');
  const screen = pane.locator(".xterm-screen");
  await screen.waitFor();
  await page.waitForFunction(() => {
    const el = document.querySelector('[data-pane-target-kind="workspaceTerminal"] .xterm-screen');
    return el && el.getBoundingClientRect().height > 300;
  });
  const material = page.locator('[data-material-surface="workbench"]').first();
  await material.evaluate((el) => {
    el.style.backgroundColor = "rgb(80,120,160)";
  });
  const sample = async () => {
    const box = await screen.boundingBox();
    return paintedPixel(
      page,
      Math.round(box.x + box.width / 2),
      Math.round(box.y + box.height / 2),
    );
  };
  const waitForColor = async (transparent) => {
    for (let attempt = 0; attempt < 50; attempt++) {
      const rgb = await sample();
      if ((rgb.join(",") === "80,120,160") === transparent) return;
      await page.waitForTimeout(100);
    }
    console.log(
      "Terminal paint diagnostics",
      await sample(),
      await screen.evaluate((el) => {
        const ancestors = [];
        while (el) {
          const css = getComputedStyle(el);
          ancestors.push({
            tag: el.tagName,
            classes: el.className,
            background: css.backgroundColor,
            image: css.backgroundImage,
            opacity: css.opacity,
          });
          el = el.parentElement;
        }
        return ancestors;
      }),
    );
    NodeAssert.fail(
      `Terminal Session did not ${transparent ? "reveal its material" : "paint ANSI background"}`,
    );
  };
  const command = async (text) => {
    await pane.locator("textarea").focus();
    await page.keyboard.type(text);
    await page.keyboard.press("Enter");
  };
  await command("printf '\\033[41m\\033[2J'; sleep 1");
  await waitForColor(false);
  await command("printf '\\033[0m\\033]11;#000000\\007\\033[2J'");
  await waitForColor(true);
  await page.reload({ waitUntil: "domcontentloaded" });
  await screen.waitFor();
  await material.evaluate((el) => {
    el.style.backgroundColor = "rgb(80,120,160)";
  });
  await page.waitForTimeout(500);
  await waitForColor(true);
  await material.evaluate((el) => {
    el.style.removeProperty("background-color");
  });
}
