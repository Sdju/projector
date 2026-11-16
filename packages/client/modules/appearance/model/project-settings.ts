import { onMounted, ref, useId, watch, type Ref } from "vue";
import {
  appearanceFontMax,
  appearanceFontMin,
  isAppearanceChoice,
  type AppearanceChoice,
  type AppearanceFontKey,
  type AppearanceFonts,
  type ProjectAppearanceOverride,
  type ProjectAppearanceState,
} from "@ai-projector/core/modules/appearance/index.ts";
import { commandArgs, useCommandScope } from "../../../common/utilities/commands.ts";
import { useSectionAction } from "../../../common/utilities/use-section-action.ts";
import { refreshProjectAppearance } from "../appearance.ts";

async function request(
  projectId: string,
  init?: RequestInit,
  path = "",
): Promise<ProjectAppearanceState> {
  const headers = new Headers(init?.headers);
  headers.set("Content-Type", "application/json");
  const response = await fetch(`/api/projects/${encodeURIComponent(projectId)}/appearance${path}`, {
    ...init,
    headers,
  });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || "Не удалось обновить оформление проекта");
  return data as ProjectAppearanceState;
}

type Draft = {
  choice: AppearanceChoice | "";
  fonts: { chat: number | ""; editor: number | ""; terminal: number | "" };
};

function emptyDraft(): Draft {
  return { choice: "", fonts: { chat: "", editor: "", terminal: "" } };
}

function draftFrom(override: ProjectAppearanceOverride): Draft {
  return {
    choice: override.choice ?? "",
    fonts: {
      chat: override.fonts?.chat ?? "",
      editor: override.fonts?.editor ?? "",
      terminal: override.fonts?.terminal ?? "",
    },
  };
}

function overrideFrom(draft: Draft): ProjectAppearanceOverride {
  const fonts: Partial<AppearanceFonts> = {};
  for (const key of ["chat", "editor", "terminal"] as const) {
    const value = draft.fonts[key];
    if (value === "") continue;
    fonts[key] = value;
  }
  const override: ProjectAppearanceOverride = {};
  if (draft.choice !== "" && isAppearanceChoice(draft.choice)) override.choice = draft.choice;
  if (Object.keys(fonts).length) override.fonts = fonts;
  return override;
}

/** Settings for `.projector/appearance.json`: draft, trust and IDE commands. */
export function useProjectAppearanceSettings(projectId: Ref<string> | (() => string)) {
  const idOf = () => (typeof projectId === "function" ? projectId() : projectId.value);
  const state = ref<ProjectAppearanceState | null>(null);
  const draft = ref(emptyDraft());
  const { ready, busy, error, status, load: loadSection, perform } = useSectionAction();
  const commands = useCommandScope(`project-appearance:${useId()}`, () => ({
    surface: "settings",
    projectId: idOf(),
  }));

  async function load() {
    await loadSection(async () => {
      const next = await request(idOf());
      state.value = next;
      draft.value = draftFrom(next.override);
    }, "Не удалось загрузить оформление проекта");
  }

  async function save() {
    const previous = state.value;
    await perform(
      async () => {
        const next = await request(idOf(), {
          method: "PUT",
          body: JSON.stringify(overrideFrom(draft.value)),
        });
        state.value = next;
        draft.value = draftFrom(next.override);
        await refreshProjectAppearance().catch(() => undefined);
        return next;
      },
      {
        errorFallback: "Не удалось сохранить оформление проекта",
        success: "Сохранено — выдайте доверие к новому содержимому",
        rollback: () => {
          if (previous) {
            state.value = previous;
            draft.value = draftFrom(previous.override);
          }
        },
      },
    );
  }

  async function trust(trusted: boolean) {
    await perform(
      async () => {
        const next = await request(
          idOf(),
          { method: "PUT", body: JSON.stringify({ trusted }) },
          "/trust",
        );
        state.value = next;
        await refreshProjectAppearance().catch(() => undefined);
        return next;
      },
      {
        errorFallback: trusted ? "Не удалось выдать доверие" : "Не удалось отозвать доверие",
        success: trusted ? "Оформление проекта доверено" : "Доверие отозвано",
      },
    );
  }

  function setFont(key: AppearanceFontKey, value: number | "") {
    draft.value = {
      ...draft.value,
      fonts: { ...draft.value.fonts, [key]: value },
    };
  }

  commands.scope.registerCommand({
    id: "ide.project.appearance.get",
    title: "Состояние оформления проекта",
    description:
      "Возвращает .projector/appearance.json, доверие и черновик override (choice и fonts).",
    run: async () => {
      await load();
      return state.value;
    },
  });
  commands.scope.registerCommand({
    id: "ide.project.appearance.set",
    title: "Записать оформление проекта",
    description:
      "Пишет .projector/appearance.json. Пустые поля наследуют глобальные. После записи нужно заново доверить файл.",
    arguments: {
      choice: "string?: dark|light|contrast|auto|внешняя тема, или пусто чтобы наследовать",
      chat: "number?: размер текста чата, или опустить",
      editor: "number?: размер шрифта редактора",
      terminal: "number?: размер шрифта терминала",
      clear: "boolean?: стереть все override и оставить пустой файл наследования",
    },
    run: async (value) => {
      const args = commandArgs(value);
      if (args.clear === true) draft.value = emptyDraft();
      else {
        if (args.choice === "" || args.choice === null) draft.value.choice = "";
        else if (typeof args.choice === "string" && isAppearanceChoice(args.choice))
          draft.value.choice = args.choice;
        for (const key of ["chat", "editor", "terminal"] as const) {
          if (args[key] === "" || args[key] === null) setFont(key, "");
          else if (typeof args[key] === "number") setFont(key, args[key] as number);
        }
      }
      await save();
      return state.value;
    },
  });
  commands.scope.registerCommand({
    id: "ide.project.appearance.trust",
    title: "Доверие к оформлению проекта",
    description: "Выдаёт или отзывает доверие к текущему хешу .projector/appearance.json.",
    arguments: { trusted: "boolean: true — доверять, false — отозвать" },
    run: async (value) => {
      const { trusted } = commandArgs(value);
      if (typeof trusted !== "boolean") throw new Error("Укажите trusted");
      await trust(trusted);
      return state.value;
    },
  });

  watch(
    () => idOf(),
    () => void load().catch(() => undefined),
  );
  onMounted(() => void load().catch(() => undefined));

  return {
    state,
    draft,
    ready,
    busy,
    error,
    status,
    min: appearanceFontMin,
    max: appearanceFontMax,
    commands,
    load,
    save,
    trust,
    setFont,
  };
}
