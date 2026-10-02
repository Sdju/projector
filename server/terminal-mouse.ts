import type { Terminal } from "@xterm/headless";

/** SerializeAddon saves tracking but omits the mouse report encoding. */
export function trackMouseEncoding(terminal: Terminal): { serialize: () => string } {
  let encoding: "default" | "sgr" | "pixels" = "default";
  for (const final of ["h", "l"]) {
    terminal.parser.registerCsiHandler({ prefix: "?", final }, (params) => {
      for (const param of params) {
        if (param === 1006 || param === 1016)
          encoding = final === "l" ? "default" : param === 1006 ? "sgr" : "pixels";
      }
      return false; // Let xterm apply the same modes normally.
    });
  }
  terminal.parser.registerEscHandler({ final: "c" }, () => {
    encoding = "default";
    return false;
  });
  // Also discover the mode of sessions retained across a Vite server reload.
  // DECRQM uses public parser/onData APIs and does not change the screen.
  const probe = terminal.onData((data) => {
    if (data === "\x1b[?1006;1$y") encoding = "sgr";
    if (data === "\x1b[?1016;1$y") encoding = "pixels";
  });
  terminal.write("\x1b[?1006$p\x1b[?1016$p", () => probe.dispose());
  return {
    serialize: () => encoding === "sgr" ? "\x1b[?1006h" : encoding === "pixels" ? "\x1b[?1016h" : "",
  };
}
