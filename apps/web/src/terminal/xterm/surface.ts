import "@xterm/xterm/css/xterm.css";
import "./surface.css";
import { transparentXtermTheme } from "./theme";
import { TransparentTerminalOutput } from "./transparentOutput";
import { Terminal, type ITheme } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import { WebLinksAddon } from "@xterm/addon-web-links";
import { WebglAddon } from "@xterm/addon-webgl";
import { Unicode11Addon } from "@xterm/addon-unicode11";

export interface XtermTerminalSurfaceOptions {
  theme: ITheme;
  font: { family?: string; size: number };
  visible?: boolean;
  topFade?: boolean;
  onData: (data: string) => void;
  onResize: (cols: number, rows: number) => void;
  onSelectionChange?: () => void;
  beforeKey?: (event: KeyboardEvent) => boolean;
  onLinkActivate?: (text: string, event: MouseEvent) => void;
  onContextMenu?: (event: MouseEvent) => void;
}

export interface TerminalSelectionPosition {
  start: { x: number; y: number };
  end: { x: number; y: number };
}

/**
 * Translate the drawer's `beforeKey` contract into the return value xterm's
 * custom key handler expects.
 *
 * Both sides use "true means the terminal owns this key", so the two values
 * line up directly. Returning the inverse silently drops every keystroke:
 * paste still works because it bypasses the key handler, which makes the bug
 * look like a focus problem instead of a dispatch problem. A missing
 * `beforeKey` leaves the key to xterm.
 */
export function shouldXtermHandleKey(
  event: KeyboardEvent,
  beforeKey?: (event: KeyboardEvent) => boolean,
): boolean {
  return beforeKey ? beforeKey(event) : true;
}

export class XtermTerminalSurface {
  private readonly terminal: Terminal;
  private readonly fitAddon: FitAddon;
  private webglAddon: WebglAddon | null = null;
  private readonly mount: HTMLElement;
  private readonly options: XtermTerminalSurfaceOptions;
  private cleanups: Array<() => void> = [];
  /**
   * True while history is being replayed into a fresh buffer. Replayed bytes
   * describe the past, so any protocol query inside them must not be answered:
   * that reply would arrive as unexpected input at the live shell's prompt.
   */
  private suppressReplies = false;
  /** Invalidates an older replay's completion callback when a newer one starts. */
  private replySuppressionToken = 0;
  private disposed = false;
  private readonly output = new TransparentTerminalOutput();

  private constructor(host: HTMLElement, options: XtermTerminalSurfaceOptions) {
    // Async setup can overlap a cancelled instance during StrictMode or View
    // remounts. Each instance owns its DOM so stale disposal cannot strip the
    // live renderer's transparency/fade markers from a shared React host.
    const mount = document.createElement("div");
    host.appendChild(mount);
    this.mount = mount;
    this.options = options;

    this.terminal = new Terminal({
      allowProposedApi: true,
      allowTransparency: true,
      convertEol: false,
      cursorBlink: true,
      cursorStyle: "bar",
      ...(options.font.family ? { fontFamily: options.font.family } : {}),
      fontSize: options.font.size,
      lineHeight: 1.15,
      macOptionIsMeta: true,
      minimumContrastRatio: 1,
      rescaleOverlappingGlyphs: true,
      theme: transparentXtermTheme(options.theme),
    });

    this.fitAddon = new FitAddon();
    this.terminal.loadAddon(this.fitAddon);

    try {
      const unicode11 = new Unicode11Addon();
      this.terminal.loadAddon(unicode11);
      this.terminal.unicode.activeVersion = "11";
    } catch {
      // Ignore if Unicode 11 addon is not supported in this runtime
    }

    this.terminal.loadAddon(
      new WebLinksAddon((event, uri) => {
        event.preventDefault();
        this.options.onLinkActivate?.(uri, event);
      }),
    );

    // Terminal protocol queries stay with the renderer. It is the only place
    // that knows the real screen state and the appearance actually painted on
    // screen, so its replies are the truthful ones: OSC 10/11/12 come back
    // with this theme's colors (correct in light and dark), and DSR 5/6 with
    // this buffer's status and cursor position. The daemon keeps no emulator,
    // so it could only fabricate those answers. Replies reach the PTY through
    // the surface's `onData`, exactly like typed input.

    const dataDisposable = this.terminal.onData((data) => {
      if (this.suppressReplies) return;
      this.options.onData(data);
    });
    this.cleanups.push(() => dataDisposable.dispose());

    const resizeDisposable = this.terminal.onResize(({ cols, rows }) => {
      this.options.onResize(cols, rows);
    });
    this.cleanups.push(() => resizeDisposable.dispose());

    const selectionDisposable = this.terminal.onSelectionChange(() => {
      this.options.onSelectionChange?.();
    });
    this.cleanups.push(() => selectionDisposable.dispose());

    this.terminal.attachCustomKeyEventHandler((event: KeyboardEvent) =>
      shouldXtermHandleKey(event, this.options.beforeKey),
    );

    mount.classList.add("acode-terminal-surface");
    this.terminal.open(mount);
    if (options.topFade) {
      const update = () => this.updateTopFade();
      const listeners = [
        this.terminal.onScroll(update),
        this.terminal.onRender(update),
        this.terminal.onCursorMove(update),
        this.terminal.buffer.onBufferChange(update),
      ];
      this.cleanups.push(() => listeners.forEach((listener) => listener.dispose()));
      update();
    }

    // Attempt WebGL acceleration when available
    if (typeof window !== "undefined" && typeof window.WebGLRenderingContext !== "undefined") {
      try {
        const webgl = new WebglAddon();
        webgl.onContextLoss(() => {
          webgl.dispose();
          this.webglAddon = null;
        });
        this.terminal.loadAddon(webgl);
        this.webglAddon = webgl;
      } catch {
        this.webglAddon = null;
      }
    }

    const onContextMenu = (event: MouseEvent) => {
      this.options.onContextMenu?.(event);
    };
    mount.addEventListener("contextmenu", onContextMenu);
    this.cleanups.push(() => mount.removeEventListener("contextmenu", onContextMenu));

    if (options.visible !== false) {
      this.fit();
    }
  }

  static async create(
    mount: HTMLElement,
    options: XtermTerminalSurfaceOptions,
  ): Promise<XtermTerminalSurface> {
    return new XtermTerminalSurface(mount, options);
  }

  write(data: string | Uint8Array): void {
    if (this.disposed) return;
    this.terminal.write(this.output.write(data));
  }

  resetAndWrite(data: string | Uint8Array): void {
    if (this.disposed) return;
    this.suppressReplies = true;
    const token = ++this.replySuppressionToken;
    this.output.reset();
    this.terminal.reset();
    if (data.length === 0) {
      this.suppressReplies = false;
      return;
    }
    // xterm parses writes asynchronously, so the flag has to survive until this
    // write commits rather than just this call, and a superseded replay must
    // not clear the flag for the one that replaced it.
    this.terminal.write(this.output.write(data), () => {
      if (this.replySuppressionToken === token) this.suppressReplies = false;
    });
  }

  fit(): boolean {
    if (
      this.disposed ||
      !this.mount ||
      this.mount.clientWidth <= 0 ||
      this.mount.clientHeight <= 0
    ) {
      return false;
    }
    try {
      this.fitAddon.fit();
      return true;
    } catch {
      return false;
    }
  }

  focus(): void {
    if (this.disposed) return;
    this.terminal.focus();
  }

  blur(): void {
    if (this.disposed) return;
    this.terminal.blur();
  }

  setVisible(visible: boolean): void {
    if (this.disposed) return;
    if (visible) {
      this.fit();
    }
  }

  setTheme(theme: ITheme): void {
    if (this.disposed) return;
    this.terminal.options.theme = transparentXtermTheme(theme);
  }

  setFont(font: { family?: string; size: number }): void {
    if (this.disposed) return;
    if (font.family) {
      this.terminal.options.fontFamily = font.family;
    }
    if (font.size) {
      this.terminal.options.fontSize = font.size;
    }
    this.fit();
  }

  private updateTopFade(): void {
    if (this.disposed) return;
    const buffer = this.terminal.buffer.active;
    const screen = this.mount.querySelector(".xterm-screen");
    const rowHeight = (screen?.getBoundingClientRect().height ?? 0) / this.terminal.rows;
    const cursorRow = buffer.baseY + buffer.cursorY - buffer.viewportY;
    const cursorInFade = cursorRow >= 0 && cursorRow * rowHeight < 16;
    const show = buffer.type === "normal" && buffer.viewportY > 0 && rowHeight > 0 && !cursorInFade;
    const value = show ? "true" : "false";
    if (this.mount.dataset.terminalTopFade !== value) this.mount.dataset.terminalTopFade = value;
  }

  isAtBottom(): boolean {
    if (this.disposed) return true;
    const buffer = this.terminal.buffer.active;
    return buffer.viewportY >= buffer.baseY;
  }

  scrollToBottom(): void {
    if (this.disposed) return;
    this.terminal.scrollToBottom();
  }

  hasSelection(): boolean {
    if (this.disposed) return false;
    return this.terminal.hasSelection();
  }

  getSelection(): string {
    if (this.disposed) return "";
    return this.terminal.getSelection();
  }

  clearSelection(): void {
    if (this.disposed) return;
    this.terminal.clearSelection();
  }

  getSelectionPosition(): TerminalSelectionPosition | null {
    if (this.disposed) return null;
    const pos = this.terminal.getSelectionPosition();
    if (!pos) return null;
    return {
      start: { x: pos.start.x, y: pos.start.y },
      end: { x: pos.end.x, y: pos.end.y },
    };
  }

  getSelectionEndClientRect(): { readonly right: number; readonly bottom: number } | null {
    if (this.disposed) return null;
    const pos = this.terminal.getSelectionPosition();
    if (!pos) return null;
    const bounds = this.mount.getBoundingClientRect();
    const cellWidth = bounds.width / Math.max(1, this.terminal.cols);
    const cellHeight = bounds.height / Math.max(1, this.terminal.rows);
    const buffer = this.terminal.buffer.active;
    const viewportY = pos.end.y - buffer.viewportY;
    return {
      right: bounds.left + (pos.end.x + 1) * cellWidth,
      bottom: bounds.top + (viewportY + 1) * cellHeight,
    };
  }

  async pasteFromClipboard(
    readText: () => Promise<string>,
    isCurrent: () => boolean,
  ): Promise<void> {
    if (this.disposed) return;
    const text = await readText();
    if (!isCurrent() || !text) return;
    this.terminal.paste(text);
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    for (const cleanup of this.cleanups) {
      cleanup();
    }
    this.cleanups = [];
    try {
      this.webglAddon?.dispose();
    } catch {
      // ignore
    }
    this.webglAddon = null;
    try {
      this.fitAddon.dispose();
    } catch {
      // ignore
    }
    try {
      this.terminal.dispose();
    } catch {
      // ignore
    }
    this.mount.remove();
  }
}
