import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";

// The published package fixes node-pty modes after install; in the checkout the compiled helper
// does not exist, and `vp install` must stay a no-op here.
const helper = fileURLToPath(new URL("../packages/cli/app/fix-node-pty.js", import.meta.url));
if (existsSync(helper)) await import(helper);
