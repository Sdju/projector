import { onMounted, ref, useId } from "vue";
import {
  JUDGE_DEFAULTS,
  normalizeJudgeSettings,
  type JudgeSettings,
} from "@ai-projector/core/modules/agent-judge/index.ts";
import { commandArgs, useCommandScope } from "../../../../../common/utilities/commands.ts";
import { readJudgeSettings, writeJudgeSettings } from "../api/judge.ts";

/** The global Projector Judge settings; each chat can override them. */
export function useAgentJudgeSettings() {
  const settings = ref<JudgeSettings>({ ...JUDGE_DEFAULTS });
  const busy = ref(false);
  const error = ref("");
  const commands = useCommandScope(`agent-judge:${useId()}`, () => ({
    surface: "agentJudge",
    busy: busy.value,
    show: settings.value.show,
    auto: settings.value.auto,
    maxRisk: settings.value.maxRisk,
    confidence: settings.value.confidence,
  }));

  async function perform<T>(action: () => Promise<T>): Promise<T> {
    busy.value = true;
    error.value = "";
    try {
      return await action();
    } catch (err) {
      error.value = err instanceof Error ? err.message : "Ошибка настроек Судьи";
      throw err;
    } finally {
      busy.value = false;
    }
  }

  function adopt(next: JudgeSettings): JudgeSettings {
    settings.value = next;
    return next;
  }

  commands.scope.registerCommand({
    id: "ide.agent.judge.get",
    title: "Прочитать настройки Projector Judge",
    description:
      "Возвращает глобальные настройки Судьи: показывать ли риск в карточке подтверждения (show), разрешать ли низкий риск автоматически (auto), максимальный автоматический балл (maxRisk 1–3) и достаточную уверенность (confidence: high или high-medium).",
    run: () => perform(async () => adopt(await readJudgeSettings())),
  });
  commands.scope.registerCommand({
    id: "ide.agent.judge.set",
    title: "Настроить Projector Judge",
    description:
      "Меняет глобальные настройки Судьи. Без аргументов сохраняет состояние с экрана. maxRisk выше 3 запрещён: баллы 4–5 никогда не разрешаются автоматически.",
    arguments: {
      show: "boolean: показывать оценку в карточке",
      auto: "boolean: разрешать низкий риск автоматически",
      maxRisk: "1, 2 или 3: максимальный автоматический балл",
      confidence: "high или high-medium",
    },
    run: (value) =>
      perform(async () => {
        const args = commandArgs(value);
        const next = normalizeJudgeSettings(
          {
            show: typeof args.show === "boolean" ? args.show : settings.value.show,
            auto: typeof args.auto === "boolean" ? args.auto : settings.value.auto,
            maxRisk: args.maxRisk ?? settings.value.maxRisk,
            confidence: args.confidence ?? settings.value.confidence,
          },
          settings.value,
        );
        return adopt(await writeJudgeSettings(next));
      }),
  });

  onMounted(
    () => void perform(async () => adopt(await readJudgeSettings())).catch(() => undefined),
  );

  return { settings, busy, error, commands };
}
