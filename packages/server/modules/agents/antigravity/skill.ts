import { readFile, rm, rmdir } from "node:fs/promises";
import { dirname, join } from "node:path";
import type { AntigravitySkillState } from "@ai-projector/core/modules/agents-integration/antigravity/index.ts";
import { dataDir } from "@ai-projector/core/modules/app-paths/index.ts";
import { os } from "@ai-projector/core/modules/os/index.ts";
import { agentFeatureCatalog } from "../../agent-features/index.ts";
import { withFileLock, writeFileAtomic } from "../../atomic-files/index.ts";

export const ANTIGRAVITY_SKILL_NAME = "projector";

/** Official global Antigravity skills path (`~/.gemini/config/skills/projector/SKILL.md`). */
export function antigravitySkillFile(): string {
  return join(
    os.homeDirectory(),
    ".gemini",
    "config",
    "skills",
    ANTIGRAVITY_SKILL_NAME,
    "SKILL.md",
  );
}

const normalize = (value: string): string => value.replace(/\r\n/g, "\n").trim();

/**
 * Generates the official Antigravity `SKILL.md` describing Projector's widgets, IDE MCP commands,
 * roles, and skills. Reads live definitions from `agentFeatureCatalog` so it never drifts from the
 * running app. Never overrides Antigravity's own system prompt or identity.
 */
export function renderAntigravitySkill(): string {
  const widgets = agentFeatureCatalog.get("widgets")?.instruction().trim();
  const ide = agentFeatureCatalog.get("ide")?.instruction().trim();
  const userSkillsDir = join(dataDir(), "agent", "skills");

  const sections = [
    `---
name: ${ANTIGRAVITY_SKILL_NAME}
description: >-
  Справочник по среде Projector IDE: интерактивные Vue-виджеты в markdown-ответах, команды IDE
  через MCP-сервер projector-ide, роли и навыки Projector. Загружай, когда нужно оформить ответ
  виджетом Projector, выполнить действие в IDE или посмотреть роли, виджеты и навыки проекта.
---`,
    `# Работа в Projector IDE

Этот навык описывает возможности среды Projector, когда чат открыт внутри Projector IDE. Projector запускает Antigravity как тонкий ACP-клиент и не внедряет этот контекст автоматически — используй разделы ниже только тогда, когда они уместны для задачи пользователя.`,
  ];

  if (widgets) {
    sections.push(`## Виджеты в ответах

${widgets}

- Специальные виджеты и полные описания: команда \`ide.chat.widgets.describe\` (через MCP \`projector-ide\`, scope \`workbench\`).
- Проектные виджеты из доверенного \`.projector/widgets.json\`: команда \`ide.project.widgets.list\`.`);
  }

  if (ide) {
    sections.push(`## Команды IDE через MCP (\`projector-ide\`)

${ide}

- Если MCP-сервер \`projector-ide\` не подключён в текущей сессии, попроси пользователя включить возможность «Команды IDE через MCP» в настройках Antigravity или в острове чата (применится в новой сессии).
- Для показа секретов (ключей, токенов) без вывода в текст ответа используй инструмент \`show_secret\` из \`projector-ide\`.`);
  }

  sections.push(`## Роли и навыки Projector

Если пользователь ссылается на роли или навыки Projector, читай их по требованию — через MCP \`projector-ide\` или напрямую с диска:

- **Chat-роли (список и промпты):** \`ide.agent.roles.chat.list\`, глобальные — \`ide.agent.roles.list\`, проектные — \`ide.agent.projectRoles.list\`.
- **Навыки Projector:** \`ide.agent.skills.list\` (каталоги: \`${userSkillsDir}\`, \`<проект>/.projector/skills\`, \`<проект>/.claude/skills\`).
- **Проектные правила Antigravity:** продолжай нативно учитывать \`AGENTS.md\`, \`GEMINI.md\` и проектные навыки \`.agents/skills\` / \`.gemini/skills\`.`);

  return `${sections.join("\n\n")}\n`;
}

/** Reads the current installation status of the Antigravity Projector skill. */
export async function antigravitySkillState(
  file = antigravitySkillFile(),
): Promise<AntigravitySkillState> {
  const content = renderAntigravitySkill();
  let existing: string | undefined;
  try {
    existing = await readFile(file, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
  const status =
    existing === undefined
      ? "missing"
      : normalize(existing) === normalize(content)
        ? "installed"
        : "outdated";
  return { status, name: ANTIGRAVITY_SKILL_NAME, file, content };
}

/** Explicitly installs or updates `~/.gemini/config/skills/projector/SKILL.md` on user request. */
export async function installAntigravitySkill(
  file = antigravitySkillFile(),
): Promise<AntigravitySkillState> {
  return withFileLock(file, async () => {
    const content = renderAntigravitySkill();
    await writeFileAtomic(file, content, { mode: 0o644 });
    return { status: "installed", name: ANTIGRAVITY_SKILL_NAME, file, content };
  });
}

/** Explicitly removes `~/.gemini/config/skills/projector/SKILL.md` on user request. */
export async function removeAntigravitySkill(
  file = antigravitySkillFile(),
): Promise<AntigravitySkillState> {
  return withFileLock(file, async () => {
    await rm(file, { force: true });
    await rmdir(dirname(file)).catch(() => undefined);
    return {
      status: "missing",
      name: ANTIGRAVITY_SKILL_NAME,
      file,
      content: renderAntigravitySkill(),
    };
  });
}
