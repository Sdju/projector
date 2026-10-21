import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vite-plus/test";
import { projectInstructions } from "../server/modules/agents/projector/project-instructions.ts";

const dirs = [];
const project = async (files) => {
  const dir = await mkdtemp(join(tmpdir(), "projector-instructions-"));
  dirs.push(dir);
  for (const [name, text] of Object.entries(files)) await writeFile(join(dir, name), text);
  return dir;
};

afterEach(async () => {
  await Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

describe("project instructions", () => {
  it("is empty without a project or instruction files", async () => {
    expect(await projectInstructions(undefined)).toBe("");
    expect(await projectInstructions(await project({ "README.md": "x" }))).toBe("");
    expect(await projectInstructions(await project({ "AGENTS.md": "  \n" }))).toBe("");
  });

  it("marks the source of every file", async () => {
    const text = await projectInstructions(
      await project({ "AGENTS.md": "Use vp.", "CLAUDE.md": "Be brief." }),
    );
    expect(text).toContain("### AGENTS.md\nUse vp.");
    expect(text).toContain("### CLAUDE.md\nBe brief.");
    expect(text).toContain("не отменяют");
  });

  it("trims a long file", async () => {
    const text = await projectInstructions(await project({ "AGENTS.md": "a".repeat(50_000) }));
    expect(text).toContain("(файл обрезан)");
    expect(text.length).toBeLessThan(13_000);
  });
});

describe("model context window", () => {
  it("keeps a sane window and drops the rest", async () => {
    const { sanitizeModels } = await import("../server/modules/providers/models.ts");
    expect(
      sanitizeModels([
        { id: "a", contextTokens: 200000 },
        { id: "b", contextTokens: "32000" },
        { id: "c", contextTokens: 5 },
        { id: "d", contextTokens: 1.5 },
        { id: "e" },
      ]),
    ).toEqual([
      { id: "a", alias: "a", contextTokens: 200000 },
      { id: "b", alias: "b", contextTokens: 32000 },
      { id: "c", alias: "c" },
      { id: "d", alias: "d" },
      { id: "e", alias: "e" },
    ]);
  });
});
