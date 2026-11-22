import { expect, test } from "vite-plus/test";
import {
  filterSettingsSections,
  findSettingsSection,
  listSettingsSections,
  settingsPageItems,
  settingsPageOf,
} from "../modules/settings/query.ts";

function stub() {
  return {
    id: "root",
    title: "Корень",
    group: "Среда",
    description: "родитель",
    keywords: "окно",
    component: {},
    items: [
      {
        id: "pwa",
        title: "Приложение",
        description: "установка",
        keywords: "pwa установка",
        component: {},
      },
      { id: "live", title: "Живой", hint: "сценарий" },
    ],
  };
}

test("nested form pages resolve separately from parent and live items", () => {
  const section = stub();
  expect(settingsPageItems(section).map((item) => item.id)).toEqual(["pwa"]);
  expect(findSettingsSection([section], "pwa")?.id).toBe("root");
  expect(settingsPageOf(section, "pwa")?.item?.id).toBe("pwa");
  expect(settingsPageOf(section, "live")?.key).toBe("root");
  expect(settingsPageOf({ ...section, component: undefined }, "root")?.item).toBeUndefined();
  expect(listSettingsSections([section]).map((row) => row.id)).toEqual(["root", "pwa"]);
});

test("search keeps a parent when only a nested page matches", () => {
  const found = filterSettingsSections([stub()], "установка");
  expect(found).toHaveLength(1);
  expect(found[0].id).toBe("root");
  expect(found[0].items.map((item) => item.id)).toEqual(["pwa"]);
  expect(filterSettingsSections([stub()], "окно")[0].items.map((item) => item.id)).toEqual([
    "pwa",
    "live",
  ]);
});

test("app settings nest window, files, git and projector agent pages", async () => {
  globalThis.location = { search: "" };
  globalThis.sessionStorage = { getItem: () => null, setItem() {}, removeItem() {} };
  const { settingsSections } = await import("../modules/app-settings/sections.ts");
  const ids = settingsSections.map((section) => section.id);
  expect(ids).toEqual(
    expect.arrayContaining([
      "about",
      "interface",
      "plugins",
      "folders",
      "keybindings",
      "git",
      "agent-projector",
    ]),
  );
  for (const id of ["pwa", "editor", "files", "github", "gitlab", "agent-judge", "agent-mcp"]) {
    expect(ids).not.toContain(id);
  }
  const pages = (id) =>
    settingsPageItems(settingsSections.find((section) => section.id === id)).map((item) => item.id);
  expect(pages("interface")).toEqual(["pwa", "editor"]);
  expect(pages("folders")).toEqual(["files"]);
  expect(pages("git")).toEqual(["github", "gitlab"]);
  expect(pages("agent-projector")).toEqual([
    "agent-judge",
    "agent-memory",
    "agent-mcp",
    "agent-hooks",
    "agent-web",
    "agent-skills",
  ]);
  expect(findSettingsSection(settingsSections, "gitlab")?.id).toBe("git");
  expect(settingsPageOf(findSettingsSection(settingsSections, "pwa"), "pwa")?.item?.id).toBe("pwa");
});
