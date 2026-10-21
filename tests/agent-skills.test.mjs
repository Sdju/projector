import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vite-plus/test";
import {
  expandSlash,
  findSkill,
  listSkills,
  parseFrontmatter,
  skillsSection,
} from "../server/modules/agents/projector/projector-skills.ts";
import { projectorBackend } from "../server/modules/agents/projector/index.ts";

let previous;
let data;
let project;
beforeEach(async () => {
  previous = process.env.XDG_DATA_HOME;
  data = await mkdtemp(join(tmpdir(), "projector-skills-"));
  process.env.XDG_DATA_HOME = data;
  project = await mkdtemp(join(tmpdir(), "projector-skills-project-"));
});
afterEach(() => {
  if (previous === undefined) delete process.env.XDG_DATA_HOME;
  else process.env.XDG_DATA_HOME = previous;
});

const put = async (root, path, text) => {
  await mkdir(join(root, path, ".."), { recursive: true });
  await writeFile(join(root, path), text);
};

describe("agent skills and commands", () => {
  it("reads the front matter and the body", () => {
    expect(parseFrontmatter('---\nname: x\ndescription: "Для релиза"\n---\n\nТекст\n')).toEqual({
      meta: { name: "x", description: "Для релиза" },
      body: "Текст",
    });
    expect(parseFrontmatter("Без шапки")).toEqual({ meta: {}, body: "Без шапки" });
  });

  it("collects skills and commands, the user's winning over the project's", async () => {
    const own = join(data, "projector", "agent");
    await put(own, "skills/release/SKILL.md", "---\ndescription: Выпуск версии\n---\nШаги выпуска");
    await put(project, ".projector/skills/release/SKILL.md", "Чужой релиз");
    await put(project, ".claude/skills/lint/SKILL.md", "# Заголовок\nЧистит код линтером");
    await put(
      project,
      ".projector/commands/review.md",
      "---\nargument-hint: <ветка>\n---\nПроверь $ARGUMENTS",
    );
    await put(project, ".projector/skills/bad name/SKILL.md", "не попадёт");
    const skills = await listSkills(project);
    expect(skills.map((item) => `${item.source}:${item.kind}:${item.name}`).sort()).toEqual([
      "project:command:review",
      "project:skill:lint",
      "user:skill:release",
    ]);
    expect(findSkill(skills, "release").body).toBe("Шаги выпуска");
    expect(skills.find((item) => item.name === "lint").description).toBe("Чистит код линтером");
    expect(skillsSection(skills)).toContain("- release: Выпуск версии");
    expect(skillsSection(skills)).not.toContain("review");
    expect(skillsSection([])).toBe("");
  });

  it("expands /command and /skill, and leaves the rest as typed", async () => {
    await put(project, ".projector/commands/review.md", "Проверь $ARGUMENTS и скажи итог");
    await put(project, ".projector/commands/plain.md", "Сделай обзор");
    await put(project, ".projector/skills/release/SKILL.md", "Шаги");
    const skills = await listSkills(project);
    expect(expandSlash("/review ветку main", skills)).toBe("Проверь ветку main и скажи итог");
    expect(expandSlash("/plain", skills)).toBe("Сделай обзор");
    expect(expandSlash("/plain подробно", skills)).toBe("Сделай обзор\n\nподробно");
    expect(expandSlash("/release 1.2", skills)).toContain("навык «release»");
    expect(expandSlash("/unknown x", skills)).toBe("/unknown x");
    expect(expandSlash("обычный /review текст", skills)).toBe("обычный /review текст");
  });

  it("offers them as the slash commands of the agent", async () => {
    await put(project, ".projector/commands/review.md", "---\ndescription: Ревью\n---\nтекст");
    const names = (await projectorBackend.commands(project)).map((item) => item.name);
    expect(names).toEqual(["compact", "review"]);
  });
});
