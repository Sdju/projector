import { access } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { dataDir } from "@ai-projector/core/modules/app-paths/index.ts";
import type { AgentRoleSnapshot } from "@ai-projector/core/modules/agent-role/index.ts";

/** The same spelling the Projector skill loader accepts; a role name must not escape its folder. */
const RESOURCE_NAME = /^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/;
/** Built-in skills ship beside the Projector agent module; the path survives the packaged build. */
const SYSTEM_SKILLS = fileURLToPath(new URL("../agents/projector/system-skills", import.meta.url));

/** Where a skill or command may live: the user's folder, the project's two conventions, then the built-in ones. */
function resourceRoots(cwd?: string): string[] {
  return [
    join(dataDir(), "agent"),
    ...(cwd ? [join(cwd, ".projector"), join(cwd, ".claude")] : []),
    SYSTEM_SKILLS,
  ];
}

/** The readable file of a selected skill (`SKILL.md`) or command (`commands/<name>.md`). */
async function resourceFile(name: string, cwd?: string): Promise<string | undefined> {
  if (!RESOURCE_NAME.test(name)) return undefined;
  for (const root of resourceRoots(cwd)) {
    const files =
      root === SYSTEM_SKILLS
        ? [join(root, name, "SKILL.md")]
        : [join(root, "skills", name, "SKILL.md"), join(root, "commands", `${name}.md`)];
    for (const file of files) {
      if (
        await access(file).then(
          () => true,
          () => false,
        )
      )
        return file;
    }
  }
  return undefined;
}

/** The role's own instructions, framed for any backend; empty when the role has none. */
export function rolePromptText(role?: Pick<AgentRoleSnapshot, "name" | "prompt">): string {
  const prompt = role?.prompt?.trim();
  if (!prompt) return "";
  return `Роль «${role?.name ?? "Projector"}»: дополнительные инструкции, которым следуй в этом чате.\n\n${prompt}`;
}

/**
 * Context an external agent gets before its first message: the role prompt and the selected
 * skills with readable paths. The agent opens a skill only when the task needs it.
 */
export async function roleContext(
  role: AgentRoleSnapshot | undefined,
  cwd?: string,
): Promise<string> {
  const parts: string[] = [rolePromptText(role)].filter(Boolean);
  if (!role || role.skills === undefined) return parts.join("\n\n");
  if (!role.skills.length) {
    parts.push("Навыки в этой роли отключены.");
    return parts.join("\n\n");
  }
  const found: string[] = [];
  const missing: string[] = [];
  for (const name of role.skills) {
    const file = await resourceFile(name, cwd);
    if (file) found.push(`- ${name}: ${file}`);
    else missing.push(name);
  }
  if (found.length)
    parts.push(`Навыки роли (прочитай файл, когда он подходит задаче):\n${found.join("\n")}`);
  if (missing.length) parts.push(`Навыки роли не найдены: ${missing.join(", ")}.`);
  return parts.join("\n\n");
}

/** Keeps only the servers a role names; an omitted list keeps every configured server. */
export function selectedNames<T extends { name: string }>(
  items: readonly T[],
  names?: readonly string[],
): T[] {
  if (names === undefined) return [...items];
  const wanted = new Set(names);
  return items.filter((item) => wanted.has(item.name));
}
