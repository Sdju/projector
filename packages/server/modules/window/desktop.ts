import { existsSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { os } from "@ai-projector/core/modules/os/index.ts";

const require = createRequire(import.meta.url);
const shellHelper = fileURLToPath(new URL("../../../cli/app/desktop.ts", import.meta.url));

/** Resolve the add-on from its own package: IDE installations never need vio or GTK. */
function nativeHelper(): string[] | undefined {
  let entry: string;
  try {
    entry = require.resolve("@ai-projector/native/entry");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "MODULE_NOT_FOUND") return;
    throw error;
  }
  // The published add-on ships built JavaScript only, but a checkout also has the source entry.
  // The built copy imports `@ai-projector/ide/core/*`, which exists only after a distribution
  // build, so a checkout runs its source entry through the vio loader instead.
  const source = join(dirname(entry), "..", "..", "app", "entry.ts");
  if (existsSync(source)) entry = source;
  const loader = createRequire(entry).resolve("@zede/vio/register");
  return ["--import", pathToFileURL(loader).href, entry];
}

export const hasNativePalette = () => nativeHelper() !== undefined;

/** Catalog and shortcut checks. Linux preloads GIO; Windows reads the Start Menu without GTK. */
export const desktopArgs = () =>
  (os.capabilities.giLoader ? nativeHelper() : undefined) ?? [shellHelper];

/** Palette process. Loads GTK when this OS can host the native window. */
export const nativeArgs = () => nativeHelper() ?? [shellHelper];
