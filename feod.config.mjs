import { backendLayers, libraryLayers } from "@o-feod/oxlint-structure-plugin/presets";

const adapters = [
  {
    name: "linux-adapter",
    literals: ["^/proc(/|$)", "^(xdotool|xprop|wmctrl)$", "^org\\.kde\\."],
    allowedIn: ["core/modules/os/modules/linux/**"],
    message: "Linux-specific operations must live in the os Linux adapter",
  },
  {
    name: "windows-adapter",
    literals: ["powershell\\.exe|taskkill|ntdll|advapi32|LOCALAPPDATA|WScript\\.Shell|CredRead"],
    allowedIn: ["core/modules/os/modules/windows/**"],
    message: "Windows-specific operations must live in the os Windows adapter",
  },
];

/** Node-only infrastructure stays out of browser/domain roots except these modules. */
const nodeOnly = [
  {
    name: "node-platform",
    imports: ["node:**", "node-gtk", "dbus-next", "node-pty", "ws"],
    allowedIn: ["core/modules/app-paths/**", "core/modules/os/**"],
    message: "Platform dependency in browser/domain code",
  },
  {
    name: "node-infrastructure-modules",
    imports: ["@core/os", "@core/os/**", "@core/app-paths", "@core/app-paths/**"],
    allowedIn: ["core/modules/app-paths/**", "core/modules/os/**"],
    message: "Browser/domain code cannot consume Node OS infrastructure",
  },
];

/** FEOD architecture policy for every Projector root. Docs: docs/architecture.md */
/** @type {import("@o-feod/oxlint-structure-plugin").FeodConfig} */
export default {
  rootDefault: {
    // Only the configured roots are architecture; tooling, tests and docs are not.
    ignore: [
      "tests/**",
      "scripts/**",
      "bin/**",
      "docs/**",
      "public/**",
      "resources/**",
      "dist/**",
      "packages/vio/tests/**",
      "packages/vio/dist/**",
      "**/*.config.*",
      "feod.config.mjs",
    ],
    layerDirs: { global: "globals" },
    layerAliases: { "@core": "core/modules" },
    imports: { computed: "forbid", unresolved: "forbid" },
    cycles: { modules: true, types: "include" },
    submodules: {
      visibility: "parent-only",
      parentImports: "public",
      childImportsParent: "implementation",
    },
    globals: { allowedFiles: ["**/*.d.ts"], localImports: "forbid" },
    modules: {
      publicEntries: ["index.ts"],
      requirePublicEntry: true,
      forbiddenNames: ["common", "shared", "utils"],
    },
    inventory: { uncovered: true },
    extra: {
      largeFiles: { thresholds: { default: 400, ".vue": 500 }, files: {} },
      confine: adapters,
    },
  },
  roots: {
    src: {
      dependencies: ["core"],
      transitModules: ["agents-integration"],
      extra: { confine: [...nodeOnly, ...adapters] },
    },
    server: {
      layers: backendLayers,
      dependencies: ["core"],
      transitModules: ["agents-integration"],
    },
    native: { dependencies: ["core"] },
    core: {
      layers: libraryLayers,
      transitModules: ["agents-integration"],
      extra: { confine: [...nodeOnly, ...adapters] },
    },
    cli: { layers: libraryLayers, dependencies: ["core"] },
    "packages/vio/src": { layers: libraryLayers },
    "packages/vio/examples/counter": {},
  },
};
