import { backendLayers, cliLayers, libraryLayers } from "@o-feod/oxlint-structure-plugin/presets";

const adapters = [
  {
    name: "linux-adapter",
    literals: ["^/proc(/|$)", "^(xdotool|xprop|wmctrl)$", "^org\\.kde\\."],
    allowedIn: ["packages/core/modules/os/modules/linux/**"],
    message: "Linux-specific operations must live in the os Linux adapter",
  },
  {
    name: "windows-adapter",
    literals: ["powershell\\.exe|taskkill|ntdll|advapi32|LOCALAPPDATA|WScript\\.Shell|CredRead"],
    allowedIn: ["packages/core/modules/os/modules/windows/**"],
    message: "Windows-specific operations must live in the os Windows adapter",
  },
  {
    name: "darwin-adapter",
    literals: ["^/usr/bin/security$|^osascript$|Library/Application Support"],
    allowedIn: ["packages/core/modules/os/modules/darwin/**"],
    message: "macOS-specific operations must live in the os darwin adapter",
  },
];

/** Node-only infrastructure stays out of browser/domain roots except these modules. */
const nodeOnly = [
  {
    name: "node-platform",
    imports: ["node:**", "node-gtk", "dbus-next", "node-pty", "ws"],
    allowedIn: [
      "packages/core/modules/app-paths/**",
      "packages/core/modules/os/**",
      "packages/core/modules/os-posix/**",
    ],
    message: "Platform dependency in browser/domain code",
  },
  {
    name: "node-infrastructure-modules",
    imports: [
      "@ai-projector/core/modules/os",
      "@ai-projector/core/modules/os/**",
      "@ai-projector/core/modules/app-paths",
      "@ai-projector/core/modules/app-paths/**",
    ],
    allowedIn: [
      "packages/core/modules/app-paths/**",
      "packages/core/modules/os/**",
      "packages/core/modules/os-posix/**",
    ],
    message: "Browser/domain code cannot consume Node OS infrastructure",
  },
];

/** FEOD architecture policy for every Projector root. Docs: docs/architecture.md */
/** @type {import("@o-feod/oxlint-structure-plugin").FeodConfig} */
export default {
  rootDefault: {
    // Only the configured roots are architecture; tooling, tests and docs are not.
    ignore: [
      "**/node_modules/**",
      "**/package.json",
      "**/README.md",
      "**/LICENSE",
      "**/scripts/**",
      "tests/**",
      "evals/**",
      "scripts/**",
      "bin/**",
      "docs/**",
      "public/**",
      "resources/**",
      "dist/**",
      // Generated trees of the published packages.
      "packages/ide/**",
      "packages/native/dist/**",
      "packages/hub/packages/**",
      "packages/hub/dist/**",
      "**/*.config.*",
      "feod.config.mjs",
    ],
    layerDirs: { global: "globals" },
    layerAliases: {
      "@ai-projector/client": "packages/client",
      "@ai-projector/server": "packages/server",
      "@ai-projector/native": "packages/native",
      "@ai-projector/core": "packages/core",
      "@ai-projector/cli": "packages/cli",
      "@ai-projector/hub": "packages/hub",
    },
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
      largeFiles: {
        thresholds: { default: 400, ".vue": 500 },
        files: {
          "packages/server/modules/gitlab/browser.ts": {
            ceiling: 402,
            plan: "Вынести чтение файлов и ассетов GitLab в отдельный files.ts",
          },
          "packages/server/modules/agents/projector/projector-backend.ts": {
            ceiling: 409,
            plan: "Вынести настройку инструментов хода (guard, review, task runner) в projector-turn-setup.ts.",
          },
        },
      },
      confine: adapters,
    },
  },
  roots: {
    "packages/client": {
      dependencies: ["packages/core"],
      transitModules: ["agents-integration", "agent-widgets"],
      extra: { confine: [...nodeOnly, ...adapters] },
    },
    "packages/hub": { layers: backendLayers, dependencies: ["packages/core"] },
    "packages/server": {
      layers: backendLayers,
      dependencies: ["packages/core"],
      transitModules: ["agents-integration", "agents"],
    },
    "packages/native": { dependencies: ["packages/core"] },
    "packages/core": {
      layers: libraryLayers,
      transitModules: ["agents-integration", "agent-widgets"],
      extra: { confine: [...nodeOnly, ...adapters] },
    },
    "packages/cli": { layers: cliLayers, dependencies: ["packages/core"] },
  },
};
