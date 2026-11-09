import { expect, test } from "vite-plus/test";
import { applyAgentEvent } from "../packages/client/modules/agent-core/model/turn-events.ts";
import { isImageFile, skillName } from "../packages/client/modules/agent-core/lib/tool-file.ts";
import { inputHint } from "../packages/client/modules/agent-core/lib/tool-input.ts";
import { skillCallName, toolLabel } from "../packages/client/modules/agent-core/lib/tool-labels.ts";
import { toolVisual } from "../packages/client/modules/agent-core/lib/tool-visual.ts";
import { stripReadLineNumbers } from "../packages/core/modules/agent-read/index.ts";
import { codeLanguage } from "../packages/client/modules/agent-turns/lib/code-language.ts";

test("a call is shaped by what it does, not only by its name", () => {
  expect(toolVisual("Read")).toBe("read");
  expect(toolVisual("ReadMediaFile")).toBe("read");
  expect(toolVisual("Reading media: /tmp/shot.png", "other")).toBe("read");
  expect(toolVisual("write_file")).toBe("write");
  expect(toolVisual("MultiEdit")).toBe("edit");
  expect(toolVisual("Bash")).toBe("bash");
  expect(toolVisual("grep")).toBe("search");
  expect(toolVisual("WebFetch")).toBe("web");
  expect(toolVisual("Task")).toBe("task");
  // ACP names the action in `kind`, while the title is whatever the agent wrote.
  expect(toolVisual("ls -la", "execute")).toBe("bash");
  expect(toolVisual("cat src/app.ts", "read")).toBe("read");
  expect(toolVisual("Собрать проект", "edit")).toBe("edit");
  expect(toolVisual("mcp__server__tool")).toBe("other");
});

test("a read picture is known by its name and a skill by its folder", () => {
  expect(isImageFile("/tmp/shot.png")).toBe(true);
  expect(isImageFile("assets/logo.SVG?raw=1")).toBe(true);
  expect(isImageFile("src/app.ts")).toBe(false);
  expect(skillName("/home/u/.claude/skills/release/SKILL.md")).toBe("release");
  expect(skillName("skills\\lint\\SKILL.md")).toBe("lint");
  expect(skillName("src/SKILL.ts")).toBe("");
  expect(toolLabel("ReadMediaFile")).toBe("Чтение изображения");
  expect(toolLabel("Reading media: /tmp/shot.png")).toBe("Чтение изображения");
  expect(toolLabel("use_skill")).toBe("Загрузка навыка");
  expect(toolLabel("Invoke skill release")).toBe("Загрузка навыка: release");
  // The skill a call loads is its own name, not the word "skill".
  expect(inputHint(JSON.stringify({ skill: "release", args: "1.2" }))).toBe("release");
  expect(inputHint(JSON.stringify({ name: "release" }))).toBe("release");
  expect(skillCallName("Skill", JSON.stringify({ id: "chromium-browser-use" }))).toBe(
    "chromium-browser-use",
  );
  expect(toolLabel("Skill", JSON.stringify({ id: "chromium-browser-use" }))).toBe(
    "Загрузка навыка: chromium-browser-use",
  );
  expect(toolLabel("useSkill", JSON.stringify({ name: "lint" }))).toBe("Загрузка навыка: lint");
  expect(toolLabel("use_skill", JSON.stringify({ name: "release" }))).toBe(
    "Загрузка навыка: release",
  );
});

test("a numbered file body loses its line numbers, anything else stays", () => {
  expect(stripReadLineNumbers("1\t# Title\n2\t\n3\tBody")).toBe("# Title\n\nBody");
  expect(stripReadLineNumbers("7\tfirst\n8\tsecond\n")).toBe("first\nsecond");
  expect(stripReadLineNumbers("1\tfirst\n3\tsecond")).toBe("1\tfirst\n3\tsecond");
  expect(stripReadLineNumbers("plain text")).toBe("plain text");
});

test("a file body is highlighted by the language of its name", () => {
  expect(codeLanguage("src/app.ts")).toBe("ts");
  expect(codeLanguage("src/App.vue")).toBe("xml");
  expect(codeLanguage("C:\\project\\src\\app.mjs")).toBe("mjs");
  expect(codeLanguage("README.")).toBe("");
  expect(codeLanguage("")).toBe("");
});

test("streamed output lives while the call runs and gives way to its result", () => {
  const state = { permissions: [], questions: [], secrets: [], turns: [] };
  const assistant = { id: "a", role: "assistant", text: "", tools: [], parts: [] };
  const event = (name, data, at = 1_000) =>
    applyAgentEvent(state, assistant, { event: name, data }, () => {}, at);

  event("tool", { id: "t", name: "bash", input: { command: "make" }, kind: "execute" });
  expect(assistant.tools[0]).toMatchObject({ status: "running", kind: "execute" });
  event("tool-output", { id: "t", chunk: "line one\n" });
  event("tool-output", { id: "t", chunk: "line two\n" });
  expect(assistant.tools[0].output).toBe("line one\nline two\n");

  event("tool-result", { id: "t", name: "bash", output: { stdout: "line one\nline two\n" } });
  expect(assistant.tools[0]).toMatchObject({ status: "done", detail: expect.any(String) });
  expect(assistant.tools[0].output).toBeUndefined();
});

test("an event for a call the chat does not know is ignored", () => {
  const state = { permissions: [], questions: [], secrets: [], turns: [] };
  const assistant = { id: "a", role: "assistant", text: "", tools: [], parts: [] };
  expect(() =>
    applyAgentEvent(
      state,
      assistant,
      { event: "tool-output", data: { id: "missing", chunk: "x" } },
      () => {},
    ),
  ).not.toThrow();
});
