import {
  createAgentPreset,
  readAgentPresets,
  removeAgentPreset,
  writeAgentPreset,
} from "../api.ts";
import { commandArgs } from "../../../common/utilities/commands.ts";
import type { RegisterCommand } from "../../agent-core/index.ts";
import type {
  AgentPreset,
  AgentPresetBundle,
  AgentPresetDraft,
  AgentPresetSource,
  AgentPresetView,
} from "@ai-projector/core/modules/agent-preset/index.ts";

export interface StartPresets {
  presets: AgentPresetView[];
  projectTrusted: boolean;
  projectProblem?: string;
}

function viewsOf(bundle: AgentPresetBundle): AgentPresetView[] {
  const project = bundle.project?.trusted ? bundle.project.presets : [];
  const taken = new Set(project.map((preset) => preset.id));
  return [
    ...project.map((preset) => ({ ...preset, source: "project" as const })),
    ...bundle.presets
      .filter((preset) => !taken.has(preset.id))
      .map((preset) => ({ ...preset, source: "global" as const })),
  ];
}

/** What the empty chat screen offers: global presets plus the project's trusted ones. */
export async function loadStartPresets(projectId?: string): Promise<StartPresets> {
  const bundle = await readAgentPresets(projectId);
  return {
    presets: viewsOf(bundle),
    projectTrusted: bundle.project?.trusted === true,
    ...(bundle.project?.problem ? { projectProblem: bundle.project.problem } : {}),
  };
}

function findPreset(
  bundle: AgentPresetBundle,
  id: string,
  source?: AgentPresetSource,
): { preset: AgentPreset; source: AgentPresetSource } | undefined {
  if (source !== "global") {
    const preset = bundle.project?.presets.find((item) => item.id === id);
    if (preset) return { preset, source: "project" };
    if (source === "project") return undefined;
  }
  const preset = bundle.presets.find((item) => item.id === id);
  return preset ? { preset, source: "global" } : undefined;
}

function sourceArg(value: unknown): AgentPresetSource | undefined {
  if (value === undefined) return undefined;
  if (value === "global" || value === "project") return value;
  throw new Error("scope: global или project");
}

function draftArgs(args: Record<string, unknown>, known?: AgentPreset): AgentPresetDraft {
  const title = typeof args.title === "string" ? args.title : known?.title;
  if (!title?.trim()) throw new Error("title: название пресета");
  const prompt = typeof args.prompt === "string" ? args.prompt : (known?.prompt ?? "");
  const form = typeof args.form === "string" ? args.form : (known?.form ?? "");
  if (!prompt.trim() && !form.trim()) throw new Error("prompt или form: что отправить агенту");
  return {
    title,
    prompt,
    ...(typeof args.description === "string"
      ? { description: args.description }
      : known?.description
        ? { description: known.description }
        : {}),
    ...(form.trim() ? { form } : {}),
  };
}

/** Commands for the agent: it can list presets and add the text or form a user just approved. */
export function registerPresetCommands(register: RegisterCommand, projectId: string): void {
  register(
    "ide.agent.presets.list",
    "Пресеты для старта агента",
    async () => {
      const bundle = await readAgentPresets(projectId);
      return {
        file: bundle.file,
        presets: viewsOf(bundle).map((preset) => ({
          ...preset,
          opensForm: !!preset.form,
        })),
        project: bundle.project
          ? {
              file: bundle.project.file,
              exists: bundle.project.exists,
              trusted: bundle.project.trusted,
              problem: bundle.project.problem,
              presets: bundle.project.presets.map((preset) => ({
                ...preset,
                opensForm: !!preset.form,
              })),
            }
          : null,
      };
    },
    () => true,
    undefined,
    {
      description:
        "Возвращает пресеты, которые предлагаются на пустом экране чата: глобальные и пресеты проекта. У каждого есть id, title, prompt, необязательные description и form (Vue-разметка формы). Пресеты проекта попадают в стартовый экран только при trusted: true в блоке project; файл доверяет пользователь в настройках проекта.",
    },
  );
  register(
    "ide.agent.preset.create",
    "Создать пресет для старта агента",
    async (value) => {
      const args = commandArgs(value);
      const source = sourceArg(args.scope) ?? "global";
      const preset = draftArgs(args);
      const before = await readAgentPresets(projectId);
      const bundle =
        source === "project"
          ? await createAgentPreset(preset, projectId)
          : await createAgentPreset(preset);
      const pool = source === "project" ? (bundle.project?.presets ?? []) : bundle.presets;
      const known = new Set(
        (source === "project" ? (before.project?.presets ?? []) : before.presets).map(
          (item) => item.id,
        ),
      );
      const created = pool.find((item) => !known.has(item.id));
      return {
        source,
        preset: created ?? null,
        projectTrusted: bundle.project?.trusted,
      };
    },
    () => true,
    undefined,
    {
      description:
        "Создаёт пресет, который появится на пустом экране любого агента. scope: global (по умолчанию, личный пресет во всех проектах) или project (в .projector/presets.json этого проекта; после записи пользователь должен доверять файлу в настройках проекта). prompt — текст запроса; form — необязательная Vue-разметка формы (Form или IntelligentForm), которую пользователь заполнит перед отправкой. Если в form есть кнопка отправки, её значения уйдут агенту вместе с prompt.",
      arguments: {
        title: "название пресета (до 80 символов)",
        prompt: "текст запроса агенту (можно не указывать, если есть form)",
        description: "пояснение под названием (необязательно)",
        form: "Vue-разметка формы для заполнения перед отправкой (необязательно)",
        scope: "global (личный, во всех проектах) или project (файл проекта)",
      },
    },
  );
  register(
    "ide.agent.preset.save",
    "Изменить пресет для старта агента",
    async (value) => {
      const args = commandArgs(value);
      const id = typeof args.preset === "string" ? args.preset : "";
      if (!id) throw new Error("preset: id пресета");
      const before = await readAgentPresets(projectId);
      const known = findPreset(before, id, sourceArg(args.scope));
      if (!known) throw new Error(`Неизвестный пресет: ${id}`);
      return writeAgentPreset(
        id,
        draftArgs(args, known.preset),
        known.source === "project" ? projectId : undefined,
      );
    },
    () => true,
    undefined,
    {
      description:
        "Меняет название, описание, текст или форму пресета. preset — id из ide.agent.presets.list; scope: global или project необязателен, если id есть в обоих. Любая запись в файл проекта отзывает доверие к нему.",
      arguments: {
        preset: "id пресета",
        title: "новое название",
        prompt: "новый текст запроса",
        description: "новое описание",
        form: "новая Vue-разметка формы; пустая строка убирает форму",
        scope: "global или project (необязательно)",
      },
    },
  );
  register(
    "ide.agent.preset.delete",
    "Удалить пресет для старта агента",
    async (value) => {
      const args = commandArgs(value);
      const id = typeof args.preset === "string" ? args.preset : "";
      if (!id) throw new Error("preset: id пресета");
      const before = await readAgentPresets(projectId);
      const known = findPreset(before, id, sourceArg(args.scope));
      if (!known) throw new Error(`Неизвестный пресет: ${id}`);
      return removeAgentPreset(id, known.source === "project" ? projectId : undefined);
    },
    () => true,
    undefined,
    {
      description:
        "Удаляет пресет из личных или из файла проекта. Уже открытые чаты не меняются: пресет участвует только в стартовом экране.",
      arguments: {
        preset: "id пресета",
        scope: "global или project (необязательно)",
      },
    },
  );
}
