import { readFile } from "node:fs/promises";
import { describe, expect, test } from "vite-plus/test";
import {
  externalThemeId,
  isExternalThemeId,
  pluginApiVersion,
  sanitizePluginIconSvg,
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

const agentContribution = {
  id: "example-agent",
  title: "Example Agent",
  caption: "Запустит Example через ACP",
  icon: "sparkles",
  program: "example-agent",
  terminal: { executable: "example-agent", title: "Example" },
  command: "example-agent",
  args: ["acp"],
  binary: "example-agent",
  clientCapabilities: { mcp: { stdio: true }, nested: { values: [1, 2] } },
  usage: { kind: "command", command: "example-agent", args: ["usage", "--json"], timeoutMs: 10000 },
  usageReporting: "projector/usage",
};

const agentManifest = {
  name: "@acme/example-agent",
  version: "1.0.0",
  engines: { projector: ">=0.12.0" },
  projector: { apiVersion: 1, contributes: { agents: [agentContribution] } },
};

function withAgent(agent) {
  const copy = structuredClone(agentManifest);
  copy.projector.contributes.agents[0] = agent;
  return copy;
}

describe("plugin agent contribution", () => {
  test("keeps API version 1 and accepts an agent-only manifest", () => {
    expect(pluginApiVersion).toBe(1);
    expect(validatePluginManifest(agentManifest)).toEqual(agentManifest);
    expect(validatePluginManifest(agentManifest).projector.contributes.themes).toBeUndefined();
    const minimal = structuredClone(agentManifest);
    minimal.projector.contributes.agents[0] = {
      id: "minimal",
      title: "Minimal",
      command: "minimal",
      usage: { kind: "none" },
    };
    expect(validatePluginManifest(minimal)).toEqual(minimal);
  });

  test("accepts a mixed manifest and an empty unused contribution list", () => {
    const mixed = structuredClone(agentManifest);
    mixed.projector.contributes.themes = [
      { id: "night", title: "Night", mode: "dark", tokens: "themes/night.json" },
    ];
    expect(validatePluginManifest(mixed)).toEqual(mixed);
    const emptyThemes = structuredClone(agentManifest);
    emptyThemes.projector.contributes.themes = [];
    expect(validatePluginManifest(emptyThemes)).toEqual(emptyThemes);
    const emptyAgents = structuredClone(manifest);
    emptyAgents.projector.contributes.agents = [];
    expect(validatePluginManifest(emptyAgents)).toEqual(emptyAgents);
  });

  test("rejects missing or empty contributions", () => {
    expect(() =>
      validatePluginManifest({
        ...structuredClone(manifest),
        projector: { apiVersion: 1, contributes: {} },
      }),
    ).toThrow(/хотя бы одну тему или агента/);
    expect(() =>
      validatePluginManifest({
        ...structuredClone(manifest),
        projector: { apiVersion: 1, contributes: { themes: [], agents: [] } },
      }),
    ).toThrow(/хотя бы одну тему или агента/);
    expect(() =>
      validatePluginManifest({
        ...structuredClone(manifest),
        projector: { apiVersion: 1, contributes: { themes: [] } },
      }),
    ).toThrow(/хотя бы одну тему/);
    expect(() =>
      validatePluginManifest({
        ...structuredClone(agentManifest),
        projector: { apiVersion: 1, contributes: { agents: [] } },
      }),
    ).toThrow(/хотя бы одного агента/);
    expect(() =>
      validatePluginManifest({ ...agentManifest, projector: { apiVersion: 2, contributes: {} } }),
    ).toThrow(/Неподдерживаемая версия API/);
  });

  test("rejects duplicate and malformed identifiers", () => {
    const duplicate = structuredClone(agentManifest);
    duplicate.projector.contributes.agents.push(structuredClone(agentContribution));
    expect(() => validatePluginManifest(duplicate)).toThrow(/Повторяющийся идентификатор агента/);
    for (const id of ["", "Example", "-example", "example agent", "example/agent"]) {
      expect(() => validatePluginManifest(withAgent({ ...agentContribution, id }))).toThrow(
        /Некорректный идентификатор агента/,
      );
    }
    for (const program of ["Example", "-example", "example agent", "example/agent"]) {
      expect(() => validatePluginManifest(withAgent({ ...agentContribution, program }))).toThrow(
        /Некорректная программа агента/,
      );
    }
  });

  test("rejects unsafe argv and binary values", () => {
    for (const command of ["", "   ", "agent\necho", "agent\0echo", "x".repeat(1001)]) {
      expect(() => validatePluginManifest(withAgent({ ...agentContribution, command }))).toThrow(
        /Команда агента/,
      );
    }
    for (const args of [
      [""],
      ["acp\n--exec"],
      ["acp\0"],
      ["x".repeat(1001)],
      Array.from({ length: 65 }, () => "arg"),
      "acp",
    ]) {
      expect(() => validatePluginManifest(withAgent({ ...agentContribution, args }))).toThrow(
        /Аргументы агента/,
      );
    }
    for (const binary of ["", "agent\necho", "agent\0echo", "x".repeat(1001)]) {
      expect(() => validatePluginManifest(withAgent({ ...agentContribution, binary }))).toThrow(
        /Бинарник агента/,
      );
    }
  });

  test("rejects unknown agent, terminal and usage fields", () => {
    for (const field of [
      "env",
      "capabilities",
      "dialect",
      "extensions",
      "plan",
      "settings",
      "secrets",
      "shell",
    ]) {
      expect(() =>
        validatePluginManifest(withAgent({ ...agentContribution, [field]: true })),
      ).toThrow(/неизвестные поля/);
    }
    expect(() =>
      validatePluginManifest(
        withAgent({ ...agentContribution, terminal: { executable: "agent", shell: true } }),
      ),
    ).toThrow(/Терминал агента: неизвестные поля/);
    expect(() =>
      validatePluginManifest(
        withAgent({
          ...agentContribution,
          usage: { kind: "command", command: "agent", env: {} },
        }),
      ),
    ).toThrow(/usage агента: неизвестные поля/);
    expect(() =>
      validatePluginManifest(
        withAgent({ ...agentContribution, usage: { kind: "none", command: "agent" } }),
      ),
    ).toThrow(/usage агента: неизвестные поля/);
  });

  test("validates usage kind and timeout", () => {
    for (const usage of [
      { kind: "http", command: "agent" },
      { kind: "command" },
      { kind: "command", command: "agent\nusage" },
      { kind: "command", command: "agent", timeoutMs: 99 },
      { kind: "command", command: "agent", timeoutMs: 60001 },
      { kind: "command", command: "agent", timeoutMs: 1000.5 },
      { kind: "command", command: "agent", timeoutMs: "1000" },
    ]) {
      expect(() => validatePluginManifest(withAgent({ ...agentContribution, usage }))).toThrow(
        /usage/,
      );
    }
    expect(
      validatePluginManifest(
        withAgent({
          ...agentContribution,
          usage: { kind: "command", command: "agent", timeoutMs: 100 },
        }),
      ),
    ).toBeTruthy();
    expect(
      validatePluginManifest(
        withAgent({
          ...agentContribution,
          usage: { kind: "command", command: "agent", timeoutMs: 60000 },
        }),
      ),
    ).toBeTruthy();
  });

  test("validates icon and usageReporting", () => {
    for (const icon of [
      "Sparkles",
      "../sparkles",
      "/sparkles.svg",
      "../x.svg",
      "icons/foo.png",
      "",
      "x".repeat(51),
    ]) {
      expect(() => validatePluginManifest(withAgent({ ...agentContribution, icon }))).toThrow(
        /Некорректная иконка агента/,
      );
    }
    expect(
      validatePluginManifest(withAgent({ ...agentContribution, icon: "icons/cursor.svg" })),
    ).toBeTruthy();
    for (const usageReporting of [
      "Projector/Usage",
      "/usage",
      "usage reporting",
      "x".repeat(101),
    ]) {
      expect(() =>
        validatePluginManifest(withAgent({ ...agentContribution, usageReporting })),
      ).toThrow(/usageReporting/);
    }
    expect(
      validatePluginManifest(
        withAgent({ ...agentContribution, icon: "sparkles-2", usageReporting: "acme/usage_v1" }),
      ),
    ).toBeTruthy();
  });

  test("sanitizes a plugin SVG icon and rejects executable markup", () => {
    expect(sanitizePluginIconSvg(`<svg viewBox="0 0 24 24"><path d="M1 1h1"/></svg>`)).toBe(
      `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor"><path d="M1 1h1"/></svg>`,
    );
    for (const svg of [
      `<svg><script>alert(1)</script></svg>`,
      `<svg onload="alert(1)"><path d="M1 1"/></svg>`,
      `<svg><path d="M1" /><svg><path d="M2"/></svg></svg>`,
      `<svg><image href="https://evil.test"/></svg>`,
      "not-svg",
    ])
      expect(() => sanitizePluginIconSvg(svg)).toThrow(/Некорректная SVG-иконка агента/);
  });

  test("validates clientCapabilities as bounded plain JSON", () => {
    const withProto = JSON.parse('{"__proto__": {"polluted": true}}');
    expect(() =>
      validatePluginManifest(withAgent({ ...agentContribution, clientCapabilities: withProto })),
    ).toThrow(/недопустимое поле __proto__/);
    for (const key of ["constructor", "prototype"]) {
      expect(() =>
        validatePluginManifest(
          withAgent({ ...agentContribution, clientCapabilities: { [key]: true } }),
        ),
      ).toThrow(/недопустимое поле/);
    }
    expect(() =>
      validatePluginManifest(
        withAgent({
          ...agentContribution,
          clientCapabilities: { data: "x".repeat(20001) },
        }),
      ),
    ).toThrow(/20000/);
    expect(() =>
      validatePluginManifest(withAgent({ ...agentContribution, clientCapabilities: [] })),
    ).toThrow(/объектом/);
    expect(() =>
      validatePluginManifest(withAgent({ ...agentContribution, clientCapabilities: null })),
    ).toThrow(/объектом/);
    expect(() =>
      validatePluginManifest(
        withAgent({
          ...agentContribution,
          clientCapabilities: { nested: { list: [true, null, "x"], deep: { ok: 1 } } },
        }),
      ),
    ).toBeTruthy();
  });

  test("validates terminal and text lengths", () => {
    for (const terminal of [
      { program: "agent\necho" },
      { executable: "" },
      { executable: "agent\0echo" },
      { title: "x".repeat(201) },
      1,
      null,
    ]) {
      expect(() => validatePluginManifest(withAgent({ ...agentContribution, terminal }))).toThrow(
        /Терминал агента|Название терминала агента/,
      );
    }
    expect(
      validatePluginManifest(
        withAgent({ ...agentContribution, terminal: { program: "agent", executable: "agent" } }),
      ),
    ).toBeTruthy();
    expect(() => validatePluginManifest(withAgent({ ...agentContribution, title: "" }))).toThrow(
      /Название агента/,
    );
    expect(() =>
      validatePluginManifest(withAgent({ ...agentContribution, title: "x".repeat(201) })),
    ).toThrow(/Название агента/);
    expect(() =>
      validatePluginManifest(withAgent({ ...agentContribution, caption: "x".repeat(301) })),
    ).toThrow(/Подпись агента/);
  });
});

function withServer(server, base = agentManifest) {
  const copy = structuredClone(base);
  copy.projector.server = server;
  return copy;
}

describe("plugin server entry", () => {
  test("accepts a package-relative code entry next to agent contributions", () => {
    for (const server of ["dist/server.cjs", "./dist/server.cjs"]) {
      expect(validatePluginManifest(withServer(server))).toEqual(withServer(server));
    }
  });

  test("accepts npm-style private and type metadata", () => {
    const copy = structuredClone(withServer("dist/server.cjs"));
    copy.private = true;
    copy.type = "module";
    expect(validatePluginManifest(copy)).toEqual(copy);
    expect(() => validatePluginManifest({ ...copy, type: "commonjs" })).toThrow(/type/);
    expect(() => validatePluginManifest({ ...copy, private: "yes" })).toThrow(/private/);
  });

  test("rejects a server entry without agent contributions", () => {
    expect(() => validatePluginManifest(withServer("dist/server.cjs", manifest))).toThrow(
      /contributes\.agents/,
    );
    expect(() =>
      validatePluginManifest({
        name: manifest.name,
        version: manifest.version,
        projector: {
          apiVersion: 1,
          server: "dist/server.cjs",
          contributes: {
            themes: [{ id: "night", title: "Night", mode: "dark", tokens: "themes/night.json" }],
          },
        },
      }),
    ).toThrow(/projector\.server/);
  });

  test("rejects absolute, traversal and non-JavaScript server paths", () => {
    for (const server of [
      "/dist/server.cjs",
      "\\dist\\server.js",
      "C:\\dist\\server.js",
      "../server.js",
      "dist/../../server.js",
      "dist\\server.js",
      "dist/server.ts",
      "dist/server.mjs",
      "dist/server",
      "dist/server.cjs\0",
      "",
      "x".repeat(301),
      42,
    ]) {
      expect(() => validatePluginManifest(withServer(server))).toThrow(/projector\.server/);
    }
  });
});
