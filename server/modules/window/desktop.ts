import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { os } from "../../../core/modules/os/index.ts";

const require = createRequire(import.meta.url);
export const desktopHelper = fileURLToPath(
  new URL("../../../native/app/entry.ts", import.meta.url),
);
// GTK loader stays on Linux. Windows catalog and shortcuts run without node-gtk.
export const desktopArgs = () =>
  os.capabilities.nativeDesktop
    ? ["--import", require.resolve("vio/register"), desktopHelper]
    : [desktopHelper];
