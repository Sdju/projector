// The evals are a separate contour: they talk to real models, cost time and money and may fail a
// run, so the default `vp test run` (tests/**) does not include them. Plugins, resolve and the rest
// of the test setup come from the main config, so the two never diverge.
import { defineConfig } from "vite-plus";
import base from "./vite.config.ts";

export default defineConfig({
  ...base,
  test: {
    ...base.test,
    include: ["evals/**/*.test.mjs"],
  },
});
