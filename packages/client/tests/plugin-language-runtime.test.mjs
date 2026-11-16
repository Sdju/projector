import { afterEach, expect, test } from "vite-plus/test";
import {
  addLanguage,
  compileLanguageRules,
  findLanguage,
  languageRevision,
  runtimeLanguages,
} from "../modules/plugin-runtime/store.ts";

afterEach(() => {
  runtimeLanguages.value = [];
});

test("plugin languages resolve by extension and filename with deterministic priority", () => {
  const before = languageRevision.value;
  const removeLow = addLanguage(
    "@acme/fict",
    {
      id: "fict",
      title: "Fict",
      extensions: [".fict"],
      priority: 1,
    },
    compileLanguageRules([
      { pattern: "\\s+" },
      { pattern: "//[^\\n]*", token: "comment" },
      { pattern: "[A-Za-z_][A-Za-z0-9_]*", token: "variableName" },
    ]),
    (path) => path,
  );
  const removeHigh = addLanguage(
    "@acme/fict-pro",
    {
      id: "fict-pro",
      title: "Fict Pro",
      filenames: ["special.fict"],
      extensions: [".fict"],
      priority: 10,
    },
    compileLanguageRules([{ pattern: ".+", token: "string" }]),
    (path) => path,
  );
  expect(languageRevision.value).toBe(before + 2);
  expect(findLanguage("src/example.fict")?.declaration.id).toBe("fict-pro");
  expect(findLanguage("special.fict")?.declaration.title).toBe("Fict Pro");
  expect(findLanguage("src/example.txt")).toBeUndefined();
  removeHigh();
  expect(findLanguage("src/example.fict")?.declaration.id).toBe("fict");
  removeLow();
  expect(findLanguage("src/example.fict")).toBeUndefined();
  expect(languageRevision.value).toBe(before + 4);
});

test("grammar rules are bounded and cannot stall the stream parser", () => {
  expect(() => compileLanguageRules([])).toThrow(/1 до 200/);
  expect(() => compileLanguageRules([{ pattern: "(" }])).toThrow(/не компилируется/);
  expect(() => compileLanguageRules([{ pattern: "x*" }])).toThrow(/пустой строкой/);
  expect(() => compileLanguageRules([{ pattern: "x", token: "definitely-not-a-token" }])).toThrow(
    /неизвестный token/,
  );
  expect(compileLanguageRules([{ pattern: "x", token: "keyword" }])[0]?.token).toBe("keyword");
});

test("languages support compound suffixes and case-insensitive grammar rules", () => {
  const rules = compileLanguageRules([{ pattern: "keyword", token: "keyword" }], true);
  expect(rules[0].regex.test("KEYWORD")).toBe(true);
  expect(compileLanguageRules([{ pattern: "keyword" }])[0].regex.test("KEYWORD")).toBe(false);
  const remove = addLanguage(
    "compound-format",
    { id: "compound", title: "Compound Format", extensions: [".custom.json"] },
    rules,
    (path) => path,
  );
  expect(findLanguage("nested/PROBE.CUSTOM.JSON")?.declaration.id).toBe("compound");
  expect(findLanguage("probe.json")).toBeUndefined();
  remove();
});
