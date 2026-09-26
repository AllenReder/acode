# Windows Terminal Rendering Uses the DOM Renderer

Awen renders Terminal Sessions with xterm's DOM renderer on Windows and keeps
the WebGL renderer on every other platform. The WebGL glyph atlas cannot match
Windows ClearType subpixel text, so its grayscale-antialiased edges read as blur
and white fringing over a transparent or light Workbench, and terminal text no
longer matches the rest of the shell.

## Status

Accepted.

## Context

A Terminal Session View renders through `@xterm/xterm` with
`allowTransparency: true` so the Workbench Material Surface shows through the
terminal canvas (ADR-0009, ADR-0010). The WebGL addon loads whenever a WebGL
context is available.

The WebGL renderer rasterizes each glyph into a grayscale texture atlas and
samples it back onto the canvas. That cannot reproduce the ClearType subpixel
anti-aliasing Windows uses for ordinary UI text. Issue #128 reports the result:
with Window Glass enabled, terminal glyph edges show white fringes and blur in
both light and dark themes. In light mode the softness persists even when the
Workbench is fully opaque, because the terminal canvas stays transparent
regardless of Workbench opacity. macOS does not exhibit the problem.

## Decision

1. On Windows, do not load the WebGL addon; use xterm's built-in DOM renderer,
   which paints with the host's native text pipeline.
2. Platform detection reuses the desktop bridge platform (`win32`) when present
   and falls back to `navigator` signals in a plain browser.
3. `allowTransparency: true`, the transparent default canvas, and the
   renderer-owned protocol replies (OSC 10/11/12, DSR/DA) are unchanged on every
   platform.
4. macOS, Linux, and non-Windows browsers keep the WebGL renderer.

## Consequences

- Windows terminal text matches the crispness of surrounding UI text in light
  and dark, transparent and opaque.
- Windows gives up WebGL's rendering throughput; very large scrollback may
  scroll less smoothly than on macOS.
- The terminal material regression check asserts the renderer each platform
  selects, so a platform can no longer silently pick the wrong one.
