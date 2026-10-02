import "node-gtk/register";
import { registerHooks } from "node:module";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { compileSfc } from "../sfc/index.ts";

registerHooks({
  load(url, context, nextLoad) {
    if (new URL(url).pathname.endsWith(".vue")) {
      const filename = fileURLToPath(url);
      return {
        format: "module",
        source: compileSfc(readFileSync(filename, "utf8"), filename),
        shortCircuit: true,
      };
    }
    return nextLoad(url, context);
  },
});
