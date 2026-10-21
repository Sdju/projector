import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vite-plus/test";
import {
  MEMORY_CHARS,
  memorySection,
  projectMemories,
  readMemory,
  writeMemory,
} from "../server/modules/agents/projector/projector-memory.ts";
import { guardMemory } from "../server/modules/agents/projector/projector-guard.ts";

let previous;
beforeEach(async () => {
  previous = process.env.XDG_DATA_HOME;
  process.env.XDG_DATA_HOME = await mkdtemp(join(tmpdir(), "projector-memory-"));
});
afterEach(() => {
  if (previous === undefined) delete process.env.XDG_DATA_HOME;
  else process.env.XDG_DATA_HOME = previous;
});

describe("agent memory", () => {
  it("appends, replaces and clears notes of a scope", async () => {
    expect(await writeMemory("user", undefined, "отвечай коротко")).toBe("отвечай коротко");
    expect(await writeMemory("user", undefined, "без эмодзи", "append")).toBe(
      "отвечай коротко\nбез эмодзи",
    );
    expect(await writeMemory("user", undefined, "только это")).toBe("только это");
    expect(await writeMemory("user", undefined, "  ")).toBe("");
    expect(await readMemory("user")).toBe("");
  });

  it("keeps project notes apart and lists them", async () => {
    await writeMemory("project", "/work/a", "пакеты через pnpm");
    await writeMemory("project", "/work/b", "тесты через vp");
    expect(await readMemory("project", "/work/a")).toBe("пакеты через pnpm");
    expect(await projectMemories()).toEqual([
      { path: "/work/a", text: "пакеты через pnpm" },
      { path: "/work/b", text: "тесты через vp" },
    ]);
    await expect(writeMemory("project", undefined, "x")).rejects.toThrow("внутри проекта");
  });

  it("refuses notes over the limit and shows the rest in the prompt", async () => {
    await expect(writeMemory("user", undefined, "x".repeat(MEMORY_CHARS + 1))).rejects.toThrow(
      "не помещаются",
    );
    expect(await memorySection("/work/a")).toBe("");
    await writeMemory("user", undefined, "общее");
    await writeMemory("project", "/work/a", "проектное");
    const section = await memorySection("/work/a");
    expect(section).toContain("### Общие\nобщее");
    expect(section).toContain("### Этого проекта\nпроектное");
    expect(await memorySection("/work/other")).not.toContain("проектное");
  });

  it("asks before writing unless the user trusts the agent", async () => {
    const asked = [];
    const options = {
      trusting: false,
      approve: async (request) => (asked.push(request), true),
    };
    await guardMemory(options, { scope: "user", mode: "append", text: "т" });
    expect(asked[0].title).toContain("всех проектов");
    await guardMemory({ ...options, trusting: true }, { scope: "user", mode: "append", text: "т" });
    expect(asked).toHaveLength(1);
    await expect(
      guardMemory(
        { trusting: false, approve: async () => false },
        { scope: "user", mode: "append", text: "т" },
      ),
    ).rejects.toThrow("отклонил");
  });
});
