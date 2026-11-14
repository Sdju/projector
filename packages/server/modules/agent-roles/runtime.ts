import { access } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { dataDir } from "@ai-projector/core/modules/app-paths/index.ts";
import {
  renderRoleTemplate,
  type AgentRoleSnapshot,
  type AgentRoleTemplateValues,
} from "@ai-projector/core/modules/agent-role/index.ts";

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

/** The role as the prompt names it; `{role}` in a template expands to this line. */
export function roleTemplateTitle(role?: Pick<AgentRoleSnapshot, "name">): string {
  return `Роль «${role?.name ?? "Projector"}»`;
}

/** The role's own instructions, framed for any backend; empty when the role has none. */
export function rolePromptText(
  role?: Pick<AgentRoleSnapshot, "name" | "prompt" | "template">,
  values?: AgentRoleTemplateValues,
): string {
  const prompt = role?.prompt?.trim();
  if (!prompt) return "";
  // A template role builds the prompt itself: no frame, no automatic sections around it.
  if (role?.template) return renderRoleTemplate(prompt, values ?? {});
  return `${roleTemplateTitle(role)}: дополнительные инструкции, которым следуй в этом чате.\n\n${prompt}`;
}

/** The selected skills as a readable list for an external agent. */
async function roleSkillsText(
  role: Pick<AgentRoleSnapshot, "skills">,
  cwd?: string,
): Promise<string> {
  if (role.skills === undefined) return "";
  if (!role.skills.length) return "Навыки в этой роли отключены.";
  const found: string[] = [];
  const missing: string[] = [];
  for (const name of role.skills) {
    const file = await resourceFile(name, cwd);
    if (file) found.push(`- ${name}: ${file}`);
    else missing.push(name);
  }
  return [
    found.length
      ? `Навыки роли (прочитай файл, когда он подходит задаче):\n${found.join("\n")}`
      : "",
    missing.length ? `Навыки роли не найдены: ${missing.join(", ")}.` : "",
  ]
    .filter(Boolean)
    .join("\n\n");
}

/**
 * Context an external agent gets before its first message: the role prompt and the selected
 * skills with readable paths. The agent opens a skill only when the task needs it. A templated
 * role inserts what the backend knows here; `{system}`, `{features}` and `{widgets}` stay empty
 * because an external agent receives its own prompt and abilities outside this text.
 */
export async function roleContext(
  role: AgentRoleSnapshot | undefined,
  cwd?: string,
  extra?: AgentRoleTemplateValues,
): Promise<string> {
  if (!role) return "";
  const skills = await roleSkillsText(role, cwd);
  if (role.template && role.prompt?.trim()) {
    return rolePromptText(role, {
      system: "",
      features: "",
      widgets: "",
      project: cwd ? `Текущий проект: ${cwd}` : "",
      memory: "",
      mcp: "",
      summary: "",
      skills,
      role: roleTemplateTitle(role),
      ...extra,
    }).trim();
  }
  const parts: string[] = [rolePromptText(role)].filter(Boolean);
  if (role.skills !== undefined) parts.push(skills);
  return parts.filter(Boolean).join("\n\n");
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
