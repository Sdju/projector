import { expect, test } from "vite-plus/test";
import { pluginPackageKey } from "@ai-projector/core/modules/plugins/index.ts";
import {
  defaultPluginPageTab,
  filterPlugins,
  pluginHasCode,
  pluginHasRuntimeContributions,
  pluginHttpUrl,
  pluginKindHint,
  pluginMatchesKind,
  pluginRowCaption,
  pluginRowIcon,
  pluginNeedsTrust,
  pluginSummary,
  shortPluginHash,
  visiblePluginKindFilters,
  visibleThemeModeFilters,
} from "../modules/plugins/kinds.ts";

function plugin(partial = {}) {
  return {
    id: "example",
    status: "disabled",
    enabled: false,
    trusted: false,
    diagnostics: [],
    themes: [],
    agents: [],
    balances: [],
    http: [],
    languages: [],
    panels: [],
    tabs: [],
    ...partial,
  };
}

test("filterPlugins applies dark/light only on the themes slice", () => {
  const theme = {
    id: "example/ocean",
    packageName: "example",
    title: "Ocean",
    mode: "dark",
    tokens: {},
  };
  const items = [
    plugin({ id: "dark-theme", themes: [theme] }),
    plugin({
      id: "light-theme",
      themes: [{ ...theme, id: "example/sand", mode: "light" }],
    }),
    plugin({ id: "agent", agents: [{ id: "bot", title: "Bot" }] }),
  ];
  expect(filterPlugins(items, "", "all", "dark").map((item) => item.id)).toEqual([
    "dark-theme",
    "light-theme",
    "agent",
  ]);
  expect(filterPlugins(items, "", "themes", "light").map((item) => item.id)).toEqual([
    "light-theme",
  ]);
  expect(filterPlugins(items, "bot", "agents", "all").map((item) => item.id)).toEqual(["agent"]);
  expect(visiblePluginKindFilters(items, "all").map((item) => item.id)).toEqual([
    "all",
    "themes",
    "agents",
  ]);
  expect(visibleThemeModeFilters(items, "all")).toEqual([]);
  expect(visibleThemeModeFilters(items, "themes").map((item) => item.id)).toEqual([
    "all",
    "dark",
    "light",
  ]);
  expect(visiblePluginKindFilters([items[2]], "all")).toEqual([]);
});

test("code and trust flags follow the manifest, not the enabled switch", () => {
  const waiting = plugin({
    id: "cursor",
    requiresTrust: true,
    code: true,
    server: "dist/server.cjs",
    agents: [{ id: "cursor", title: "Cursor" }],
  });
  expect(pluginHasCode(waiting)).toBe(true);
  expect(pluginNeedsTrust(waiting)).toBe(true);
  expect(pluginHasRuntimeContributions(waiting)).toBe(true);
  expect(pluginRowCaption(waiting)).toBe("Cursor · нужно доверие");
  expect(pluginRowIcon(waiting)).toBe("shield-alert");
  expect(pluginKindHint(waiting)).toMatch(/серверным кодом/);
  expect(pluginMatchesKind(waiting, "code")).toBe(true);
  expect(pluginSummary([waiting, plugin({ enabled: true, status: "enabled" })])).toEqual({
    total: 2,
    enabled: 1,
    trust: 1,
    issues: 0,
  });
});

test("package page opens README when the catalog says the file exists", () => {
  expect(defaultPluginPageTab(plugin())).toBe("features");
  expect(defaultPluginPageTab(plugin({ readme: true }))).toBe("readme");
});

test("HTTP captions use the package key prefix", () => {
  const route = { id: "status", path: "api/status", methods: ["GET"] };
  expect(pluginHttpUrl("@acme/routes", route)).toBe(
    `/api/plugins/${pluginPackageKey("@acme/routes")}/api/status`,
  );
  expect(shortPluginHash("a".repeat(64))).toBe("aaaaaaaa…aaaaaa");
});
