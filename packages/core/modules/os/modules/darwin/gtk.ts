import { existsSync } from "node:fs";
import { join } from "node:path";

/** GTK4 comes from Homebrew; without it macOS keeps the Chromium palette. */
export function gtkAvailable(): boolean {
  return ["/opt/homebrew/lib", "/usr/local/lib"].some((dir) =>
    existsSync(join(dir, "libgtk-4.1.dylib")),
  );
}
