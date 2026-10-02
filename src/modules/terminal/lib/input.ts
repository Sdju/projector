import type { Terminal } from "@xterm/xterm";
import type { TerminalClientMessage } from "../../../../core/modules/terminal/index.ts";

/** Keep IME/text in UTF-8 and legacy mouse reports in their original bytes. */
export function bindTerminalInput(
  terminal: Terminal,
  send: (message: TerminalClientMessage) => void,
  available: () => boolean,
): void {
  terminal.onData((data) => {
    if (!available()) return;
    // Avoid splitting a surrogate pair across clipboard frames.
    for (let offset = 0; offset < data.length;) {
      let end = Math.min(offset + 8192, data.length);
      const last = data.charCodeAt(end - 1);
      if (end < data.length && last >= 0xd800 && last <= 0xdbff) end -= 1;
      send({ type: "input", data: data.slice(offset, end) });
      offset = end;
    }
  });
  terminal.onBinary((data) => {
    if (available()) send({ type: "input", data, encoding: "binary" });
  });
}
