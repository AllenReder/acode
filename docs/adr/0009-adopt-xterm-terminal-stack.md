# Adopt xterm.js as the web terminal renderer, with ANSI palette mapping

ACode adopts the mature `xterm.js` terminal emulation stack from reference project `paseo` for the web terminal. Terminal sessions render via `@xterm/xterm` with WebGL acceleration and full 16-color ANSI palettes, while the server daemon sanitizes the environment it hands to the PTY. The renderer, not the daemon, answers terminal protocol queries.

## Status

Accepted.

## Context

In ACode v1 (inherited from `t3code`), terminal emulation was powered by `libghostty-vt` compiled to WebAssembly paired with a hand-rolled HTML5 Canvas 2D frame renderer (`apps/web/src/terminal/ghostty/`). While native Ghostty is a high-performance GPU terminal on macOS, its WASM build in web context is only a raw VT byte parser without native GPU acceleration or HarfBuzz text shaping.

This setup suffered from multiple defects:
1. **Unanswered color probes**: Modern CLI tools (such as Claude Code and React Ink applications) query terminal background color via OSC 11 (`\x1b]11;?\x1b\`). Neither `libghostty-vt` WASM nor the server daemon answered this query.
2. **Stale environment inheritance**: On OSC 11 timeout, CLI tools fall back to `COLORFGBG`. The PTY inherited the host terminal's `COLORFGBG` (often `0;15` for light backgrounds in macOS Terminal / default environments), causing CLI tools to misidentify the terminal as light mode and emit black text (`rgb(0,0,0)`) on ACode's dark theme (`#0a0a0a`), rendering content completely invisible ("all black").
3. **Hardcoded ANSI palette**: Ghostty's Option 14 (palette) was never configured, leaving ANSI color 0 (`black`) and 8 (`brightBlack`) with near-zero contrast against dark backgrounds.
4. **Patchy Canvas backgrounds**: The custom Canvas 2D renderer only drew backgrounds when `cell.background !== snapshot.background`, creating inconsistent black patches when CLI applications explicitly emitted truecolor black (`\x1b[48;2;0;0;0m`).

Reference project `paseo` solves these problems by using `@xterm/xterm` with a complete 16-color ANSI palette. Paseo answers OSC color queries in its daemon because that daemon hosts a headless xterm that owns the screen; ACode's daemon hosts no emulator.

## Considered Options

- **Option A: Retain Ghostty WASM and patch server environment**: Keep the hand-rolled Canvas 2D renderer and WASM parser, injecting `COLORFGBG="15;0"` and intercepting OSC queries on the server. Rejected because it preserves the unmaintained Canvas 2D renderer, lacks WebGL rendering, and leaves edge-case terminal sequences unresolved.
- **Option B: Adopt Paseo's xterm.js stack**: Adopt `@xterm/xterm` on the frontend with WebGL, Fit, WebLinks, and Unicode 11 addons, and let the renderer answer the protocol queries it is the only witness to.
- **Option C: Split the replies**: suppress xterm's replies and reimplement them in the daemon. Rejected: the daemon cannot know the painted theme, cannot know the cursor position that DSR 6 reports, and its per-chunk string matching misses a query split across two reads. An earlier revision of this change did exactly this and regressed device-status replies.

## Decision

Adopt Option B:

1. **Frontend Emulator Surface (`apps/web/src/terminal/xterm/`)**:
   - Replaces the Ghostty Canvas 2D renderer with `XtermTerminalSurface` based on `@xterm/xterm`.
   - Incorporates `@xterm/addon-fit`, `@xterm/addon-web-links`, and `@xterm/addon-webgl` (with graceful fallback).
   - Keeps xterm's own protocol replies. The renderer answers OSC 10/11/12 with the colors it is painting and DSR/DA with this screen's real state, and those bytes reach the PTY through the same `onData` path as typed input.
   - Suppresses replies only while replaying restored history, so a query inside a restored snapshot cannot land at the live shell as stray input.
2. **16-Color ANSI Theme Palette (`theme.ts`)**:
   - Maps ACode's active theme tokens into a complete `ITheme` with tailored dark and light ANSI 16-color palettes adapted from Paseo, ensuring robust contrast for ANSI black, dim text, and bright variants.
3. **PTY Environment Sanitization (`Manager.ts`)**:
   - In `createTerminalSpawnEnv`, drops an inherited `COLORFGBG` instead of guessing an appearance, and declares the PTY it actually provides: `TERM="xterm-256color"`, `TERM_PROGRAM="acode"`, `COLORTERM="truecolor"`. A per-session `env` from the client still wins.
4. **No server-side emulator**:
   - The daemon keeps no screen state, so it answers no protocol queries. Anything it answered would be a second, fabricated answer competing with the renderer's.

## Consequences

The Ghostty renderer under `apps/web/src/terminal/ghostty/` and the vendored `native/libghostty-vt` pin are retained but no longer loaded by the shipped client; removing them, and the now-unused `'wasm-unsafe-eval'` CSP grant, belongs to a follow-up because mobile entrypoints that reuse the same ABI are deferred to later tickets.
