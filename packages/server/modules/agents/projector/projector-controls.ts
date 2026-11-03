import type { AgentControl } from "../../agent/index.ts";
import {
  envFallbackFromProcess,
  loadPublicProviders,
  thinkingLevel,
  thinkingOptions,
} from "../../providers/index.ts";

export const TRUST = "permission-mode";
const MODES = new Set(["default", "auto", "bypassPermissions"]);
export const THINKING = "thinking";

/** The providers to choose from and whether the agent asks before changing things. */
export async function controls(selection: Record<string, string> = {}): Promise<AgentControl[]> {
  const { providers, activeProviderId } = await loadPublicProviders(envFallbackFromProcess());
  const list: AgentControl[] = [
    {
      id: TRUST,
      via: "native",
      category: "mode",
      name: "Разрешения",
      description: "Когда агент спрашивает перед командами оболочки и правками в Projector",
      current: MODES.has(selection[TRUST]!) ? selection[TRUST]! : "default",
      options: [
        { value: "default", name: "Спрашивать", description: "Подтверждение перед изменениями" },
        {
          value: "auto",
          name: "Авто",
          description:
            "Безопасные команды оболочки выполняются сразу — их проверяет отдельный запрос к модели, остальное подтверждается",
        },
        { value: "bypassPermissions", name: "Без вопросов" },
      ],
    },
  ];
  // One option per registered model of every enabled provider; `provider:alias` picks both.
  const options = providers
    .filter((item) => item.enabled && item.url)
    .flatMap((item) =>
      item.models.length
        ? item.models.map((model) => ({
            value: `${item.id}:${model.alias}`,
            name: `${item.name} · ${model.alias}`,
          }))
        : [{ value: item.id, name: item.name }],
    );
  if (options.length) {
    const wanted = selection.provider ?? "";
    const byProvider = (id: string) => options.find((item) => item.value.split(":")[0] === id);
    // A bare provider id (older chats) means its first model; an unknown choice, the default provider.
    const current =
      options.find((item) => item.value === wanted) ??
      byProvider(wanted) ??
      byProvider(activeProviderId ?? "") ??
      options[0]!;
    const [providerId, ...alias] = current.value.split(":");
    const chosen = providers.find((item) => item.id === providerId);
    const model =
      chosen?.models.find((item) => item.alias === alias.join(":")) ?? chosen?.models[0];
    const style = model?.thinking === false || !chosen ? "none" : chosen.thinkingStyle;
    const levels = thinkingOptions(style);
    if (levels.length)
      list.push({
        id: THINKING,
        via: "native",
        category: "effort",
        name: "Размышление",
        description: "Насколько модель думает перед ответом; без него ответ быстрее и дешевле",
        current: thinkingLevel(style, selection[THINKING]),
        options: levels,
      });
    list.unshift({
      id: "provider",
      via: "native",
      category: "model",
      name: "Модель",
      description: "Провайдер и модель из настроек",
      current: current.value,
      options,
    });
  }
  return list;
}
