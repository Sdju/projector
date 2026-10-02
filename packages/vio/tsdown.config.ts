import { defineConfig } from "tsdown";

export default defineConfig({
  entry: ["src/index.ts", "src/core.ts", "src/compiler.ts", "src/register.ts"],
  format: "esm",
  platform: "node",
  target: "node24",
  dts: true,
  deps: { neverBundle: [/^gi:/, "node-gtk", "@vue/runtime-core", "@vue/compiler-sfc"] },
});
