import { createRequire } from "node:module";
import { fileURLToPath, pathToFileURL } from "node:url";
import { os } from "../../../core/modules/os/index.ts";

const require = createRequire(import.meta.url);
export const desktopHelper = fileURLToPath(
  new URL("../../../native/app/entry.ts", import.meta.url),
);
const gtkLoader = pathToFileURL(require.resolve("vio/register")).href;
const helperArgs = (preloadGtk: boolean) =>
  preloadGtk ? ["--import", gtkLoader, desktopHelper] : [desktopHelper];

/** Catalog and shortcut checks. Linux preloads GIO; Windows reads the Start Menu without GTK. */
export const desktopArgs = () => helperArgs(os.capabilities.giLoader);

/** Palette process. Loads GTK when this OS can host the native window. */
export const nativeArgs = () => helperArgs(os.capabilities.nativeDesktop);
