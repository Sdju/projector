import { defineConfig } from "tsdown";

export default defineConfig({
  entry: {
    index: "src/app/index.ts",
    core: "src/modules/renderer/index.ts",
    compiler: "src/modules/sfc/index.ts",
    register: "src/modules/loader/index.ts",
  },
  format: "esm",
  platform: "node",
  target: "node24",
  dts: true,
  deps: { neverBundle: [/^gi:/, "node-gtk", "@vue/runtime-core", "@vue/compiler-sfc"] },
});
