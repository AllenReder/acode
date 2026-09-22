/**
 * Remove only the default-background setter slot from OSC 10/11. Forward the
 * framing, queries and other slots to xterm's parser unchanged. This streaming
 * adapter retains no output history and handles commands split across PTY
 * chunks, including UTF-8 input and interrupted control strings.
 */
export class TransparentTerminalOutput {
  private decoder = new TextDecoder();
  private state: "text" | "escape" | "osc" | "string" = "text";
  private command = 0;
  private slot = 0;
  private backgroundSlot = -1;
  private backgroundQuery = "";

  reset(): void {
    this.decoder = new TextDecoder();
    this.state = "text";
    this.startOsc();
  }

  private startOsc(): void {
    this.command = 0;
    this.slot = 0;
    this.backgroundSlot = -1;
    this.backgroundQuery = "";
  }

  write(data: string | Uint8Array): string {
    const text = typeof data === "string" ? data : this.decoder.decode(data, { stream: true });
    let output = "";
    for (const char of text) {
      const code = char.charCodeAt(0);
      // xterm's anywhere transitions interrupt even DCS/APC/PM/SOS strings.
      const interrupt =
        code === 0x1b || code === 0x18 || code === 0x1a || (code >= 0x80 && code <= 0x9f);
      if (interrupt || (this.state === "osc" && code === 7)) {
        if (
          this.state === "osc" &&
          (code === 7 || code === 0x1b || code === 0x9c) &&
          this.backgroundQuery === "?" &&
          this.slot === this.backgroundSlot
        )
          output += "?";
        output += char;
        this.state =
          code === 0x1b
            ? "escape"
            : code === 0x9d
              ? "osc"
              : [0x90, 0x98, 0x9e, 0x9f].includes(code)
                ? "string"
                : "text";
        if (this.state === "osc") this.startOsc();
      } else if (this.state === "osc") {
        if (code < 0x20) {
          // C0 controls are ignored inside OSC by xterm, including within IDs.
          output += char;
        } else if (char === ";") {
          if (this.slot === this.backgroundSlot && this.backgroundQuery === "?") output += "?";
          output += char;
          if (this.slot === 0)
            this.backgroundSlot = this.command === 10 ? 2 : this.command === 11 ? 1 : -1;
          this.slot++;
        } else if (this.slot === this.backgroundSlot) {
          // Only the exact query token survives. Color strings are discarded
          // without buffering them, leaving an invalid empty color slot.
          this.backgroundQuery = this.backgroundQuery === "" && char === "?" ? "?" : "invalid";
        } else {
          output += char;
          if (this.slot === 0) {
            // Values above 11 cannot select the background. Numeric parsing
            // preserves arbitrarily many leading zeros without retaining them.
            this.command =
              code >= 48 && code <= 57 ? Math.min(12, this.command * 10 + code - 48) : 12;
          }
        }
      } else {
        output += char;
        if (this.state === "escape" && code >= 0x20 && code !== 0x7f) {
          this.state = char === "]" ? "osc" : "PX^_".includes(char) ? "string" : "text";
          if (this.state === "osc") this.startOsc();
        }
      }
    }
    return output;
  }
}
