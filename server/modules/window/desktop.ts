import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
export const desktopHelper = fileURLToPath(
  new URL("../../../native/app/entry.ts", import.meta.url),
);
// Resolve the loader absolutely: the CLI may be invoked from any directory.
export const desktopArgs = () => ["--import", require.resolve("vio/register"), desktopHelper];
