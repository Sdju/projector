import { expect, test } from "vite-plus/test";
import { applyAgentEvent } from "../src/modules/agent/model/turn-events.ts";
import { toolVisual } from "../src/modules/agent/lib/tool-visual.ts";
import { codeLanguage } from "../src/modules/agent/lib/code-language.ts";

test("a call is shaped by what it does, not only by its name", () => {
  expect(toolVisual("Read")).toBe("read");
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
