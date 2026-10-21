import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { dataDir } from "../../../../core/modules/app-paths/index.ts";

export type SkillSource = "user" | "project";

/** A skill (a folder with `SKILL.md`) or a prompt command (`commands/<name>.md`) the agent can use. */
export interface Skill {
  name: string;
  description: string;
  hint?: string;
  source: SkillSource;
  /** `skill` is loaded by the agent when its description fits; `command` is typed by the user. */
  kind: "skill" | "command";
  /** Text without the frontmatter. */
  body: string;
  /** The folder of a skill: files next to `SKILL.md` that its text mentions. */
  directory?: string;
}

const NAME = /^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/;
const BODY_CHARS = 30_000;
/** How many skills the prompt lists, and how much of each description. */
const LISTED = 40;
const DESCRIPTION_CHARS = 240;

const userRoot = () => join(dataDir(), "agent");

/** Where skills and commands are looked up. A user's own always beats a repository's of the same name. */
function roots(cwd?: string): { dir: string; source: SkillSource }[] {
  return [
    { dir: userRoot(), source: "user" },
    ...(cwd
      ? [
          { dir: join(cwd, ".projector"), source: "project" as const },
          { dir: join(cwd, ".claude"), source: "project" as const },
        ]
      : []),
  ];
}

/** `---` front matter with flat `key: value` lines, as Claude Code's skills use. */
export function parseFrontmatter(text: string): { meta: Record<string, string>; body: string } {
  const match = /^﻿?---\r?\n([\s\S]*?)\r?\n---[ \t]*(?:\r?\n|$)/.exec(text);
  if (!match) return { meta: {}, body: text.trim() };
  const meta: Record<string, string> = {};
  for (const line of match[1]!.split(/\r?\n/)) {
    const pair = /^([A-Za-z][\w-]*)\s*:\s*(.*)$/.exec(line);
    if (pair) meta[pair[1]!.toLowerCase()] = pair[2]!.trim().replace(/^(["'])(.*)\1$/, "$2");
  }
  return { meta, body: text.slice(match[0].length).trim() };
}

async function entries(dir: string) {
  try {
    return await readdir(dir, { withFileTypes: true });
  } catch {
    return [];
  }
}

async function readText(path: string): Promise<string | undefined> {
  try {
    return await readFile(path, "utf8");
  } catch {
    return undefined;
  }
}

function describe(meta: Record<string, string>, body: string, fallback: string): string {
  const line = body.split("\n").find((item) => item.trim() && !item.startsWith("#"));
  return (meta.description || line || fallback).trim().slice(0, DESCRIPTION_CHARS);
}

async function skillsIn(dir: string, source: SkillSource): Promise<Skill[]> {
  const found: Skill[] = [];
  for (const entry of await entries(join(dir, "skills"))) {
    if (!entry.isDirectory() || !NAME.test(entry.name)) continue;
    const raw = await readText(join(dir, "skills", entry.name, "SKILL.md"));
    if (!raw) continue;
    const { meta, body } = parseFrontmatter(raw);
    const name = NAME.test(meta.name ?? "") ? meta.name! : entry.name;
    found.push({
      name,
      description: describe(meta, body, name),
      hint: meta["argument-hint"],
      source,
      kind: "skill",
      body: body.slice(0, BODY_CHARS),
      directory: join(dir, "skills", entry.name),
    });
  }
  for (const entry of await entries(join(dir, "commands"))) {
    if (!entry.isFile() || !entry.name.endsWith(".md")) continue;
    const name = entry.name.slice(0, -3);
    const raw = await readText(join(dir, "commands", entry.name));
    if (!NAME.test(name) || !raw) continue;
    const { meta, body } = parseFrontmatter(raw);
    found.push({
      name,
      description: describe(meta, body, name),
      hint: meta["argument-hint"],
      source,
      kind: "command",
      body: body.slice(0, BODY_CHARS),
    });
  }
  return found;
}

/** Everything available in the project: skills and commands, the user's first, then `.projector`, then `.claude`. */
export async function listSkills(cwd?: string): Promise<Skill[]> {
  const all = (await Promise.all(roots(cwd).map((root) => skillsIn(root.dir, root.source)))).flat();
  const seen = new Set<string>();
  return all.filter((item) => {
    const key = `${item.kind}:${item.name}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

/** The part of the system prompt that names the skills; their text is read on demand by `use_skill`. */
export function skillsSection(skills: Skill[]): string {
  const own = skills.filter((item) => item.kind === "skill").slice(0, LISTED);
  if (!own.length) return "";
  return `\n\nНавыки (use_skill с именем загружает инструкцию; делай это, когда описание подходит задаче пользователя):\n${own.map((item) => `- ${item.name}: ${item.description}`).join("\n")}`;
}

/**
 * `/name arguments` typed by the user becomes the command's text, or a request to use the skill.
 * Anything else, including unknown names, goes to the model as written.
 */
export function expandSlash(message: string, skills: Skill[]): string {
  const match = /^\/([A-Za-z0-9][A-Za-z0-9_-]*)(?:\s+([\s\S]*))?$/.exec(message.trim());
  if (!match) return message;
  const args = (match[2] ?? "").trim();
  const found =
    skills.find((item) => item.kind === "command" && item.name === match[1]) ??
    skills.find((item) => item.kind === "skill" && item.name === match[1]);
  if (!found) return message;
  if (found.kind === "skill")
    return `Используй навык «${found.name}» (use_skill).${args ? `\n\n${args}` : ""}`;
  if (/\$ARGUMENTS/.test(found.body)) return found.body.replace(/\$ARGUMENTS/g, args);
  return args ? `${found.body}\n\n${args}` : found.body;
}

export function findSkill(skills: Skill[], name: string): Skill | undefined {
  return skills.find((item) => item.kind === "skill" && item.name === name);
}

/** Where the user's and a project's skills go, for the settings page. */
export const skillFolders = (cwd?: string) =>
  roots(cwd).map((root) => ({ source: root.source, path: root.dir }));
