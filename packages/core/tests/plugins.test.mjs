import { readFile } from "node:fs/promises";
import { describe, expect, test } from "vite-plus/test";
import {
  externalThemeId,
  isExternalThemeId,
  serializeThemeTokens,
  themeStyleProperties,
  themeTokenNames,
  validatePluginManifest,
  validateThemeTokens,
} from "../modules/plugins/index.ts";

const manifest = {
  name: "@scope/theme-pack",
  version: "1.2.3",
  engines: { projector: ">=0.11.0" },
  projector: {
    apiVersion: 1,
    contributes: {
      themes: [{ id: "night", title: "Night", mode: "dark", tokens: "themes/night.json" }],
    },
  },
};

const tokens = Object.fromEntries(
  themeTokenNames.map((name) => [
    name,
    name.startsWith("shadow-") ? "0 12px 32px #0008" : "#102030",
  ]),
);

describe("theme-only plugin contract", () => {
  test("validates namespaced IDs, manifest, compatibility and safe token paths", () => {
    expect(validatePluginManifest(manifest, { projectorVersion: "0.11.0" })).toEqual(manifest);
    expect(externalThemeId(manifest.name, "night")).toBe("@scope/theme-pack/night");
    expect(isExternalThemeId("@scope/theme-pack/night")).toBe(true);
    expect(isExternalThemeId("night")).toBe(false);
    expect(() => validatePluginManifest({ ...manifest, version: "latest" })).toThrow(/semver/);
    expect(() => validatePluginManifest(manifest, { projectorVersion: "0.10.0" })).toThrow(
      /несовместим/,
    );
    const traversal = structuredClone(manifest);
    traversal.projector.contributes.themes[0].tokens = "../secret.json";
    expect(() => validatePluginManifest(traversal)).toThrow(/Небезопасный путь/);
    expect(() => validatePluginManifest({ ...manifest, main: "index.js" })).toThrow(
      /неизвестные поля/,
    );
  });

  test("accepts exactly the existing token allowlist and built-in color-mix values", async () => {
    expect(themeTokenNames).toHaveLength(25);
    expect(validateThemeTokens(tokens)).toEqual(tokens);
    const builtinHover = {
      ...tokens,
      hover: "color-mix(in srgb, var(--text) 5%, transparent)",
      active: "rgb(1 2 3 / 50%)",
      "shadow-modal": "0 18px 60px hsl(0 0% 0% / 0.4)",
    };
    expect(() => validateThemeTokens(builtinHover)).toThrow(/shadow-modal/);
    expect(
      validateThemeTokens({ ...builtinHover, "shadow-modal": tokens["shadow-modal"] }),
    ).toBeTruthy();
    const withoutOptional = { ...tokens };
    delete withoutOptional.hover;
    delete withoutOptional.active;
    expect(validateThemeTokens(withoutOptional)).toBeTruthy();
    const fixture = JSON.parse(
      await readFile(
        new URL("../../server/tests/fixtures/theme-plugin/themes/paper.json", import.meta.url),
        "utf8",
      ),
    );
    expect(validateThemeTokens(fixture)).toEqual(fixture);
  });

  test("rejects missing, unknown and executable CSS values", () => {
    expect(() => validateThemeTokens({ ...tokens, extra: "#fff" })).toThrow(/неизвестные поля/);
    expect(() => validateThemeTokens({ ...tokens, bg: undefined })).toThrow(/обязателен/);
    for (const value of [
      "url(https://example.test)",
      "var(--bg)",
      "javascript:alert(1)",
      "red; color: red",
    ])
      expect(() => validateThemeTokens({ ...tokens, bg: value })).toThrow(/Недопустимое/);
    expect(() => validateThemeTokens({ ...tokens, "shadow-modal": "0 0 0 url(x)" })).toThrow(
      /Недопустимое/,
    );
  });

  test("serializes tokens to browser custom properties", () => {
    expect(themeStyleProperties(tokens)["--bg"]).toBe("#102030");
    expect(serializeThemeTokens(tokens)).toContain("--bg:#102030");
    expect(serializeThemeTokens(tokens)).not.toContain("undefined");
  });
});
