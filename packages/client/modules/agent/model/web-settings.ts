import { onMounted, ref, useId } from "vue";
import { commandArgs, useCommandScope } from "../../../common/utilities/commands.ts";
import { readAgentWeb, writeAgentWeb, type AgentWeb, type WebSearchProvider } from "../api/web.ts";

/** The search service behind the Projector agent's `web_search`. */
export function useAgentWebSettings() {
  const web = ref<AgentWeb>({ provider: "brave", url: "", hasKey: false });
  const provider = ref<WebSearchProvider>("brave");
  const url = ref("");
  /** Typed key; kept here only until it is saved. */
  const apiKey = ref("");
  const busy = ref(false);
  const error = ref("");
  const commands = useCommandScope(`agent-web:${useId()}`, () => ({
    surface: "agentWeb",
    busy: busy.value,
    provider: web.value.provider,
  }));

  async function perform<T>(action: () => Promise<T>): Promise<T> {
    busy.value = true;
    error.value = "";
    try {
      return await action();
    } catch (err) {
      error.value = err instanceof Error ? err.message : "Ошибка веб-поиска агента";
      throw err;
    } finally {
      busy.value = false;
    }
  }

  function adopt(next: AgentWeb): AgentWeb {
    web.value = next;
    provider.value = next.provider;
    url.value = next.url;
    apiKey.value = "";
    return next;
  }

  commands.scope.registerCommand({
    id: "ide.agent.web.get",
    title: "Прочитать настройки веб-поиска агента",
    description:
      "Возвращает поисковый сервис штатного агента Projector (brave или searxng), адрес SearXNG и сохранён ли ключ. Сам ключ не возвращается.",
    enabled: () => !busy.value,
    run: () => perform(async () => adopt(await readAgentWeb())),
  });
  commands.scope.registerCommand({
    id: "ide.agent.web.set",
    title: "Выбрать веб-поиск агента",
    description:
      "Задаёт поисковый сервис штатного агента: provider brave (нужен ключ Brave Search, его вводит пользователь на экране или в запросе секрета) или searxng (url своего сервера). Без аргументов сохраняет выбор с экрана. Ключ через команду не передаётся.",
    arguments: {
      provider: "brave или searxng",
      url: "Адрес сервера SearXNG, для brave не нужен",
    },
    enabled: () => !busy.value,
    run: (value) => {
      const args = commandArgs(value);
      const chosen = (args.provider ?? provider.value) as WebSearchProvider;
      const address = typeof args.url === "string" ? args.url : url.value;
      return perform(async () =>
        adopt(await writeAgentWeb({ provider: chosen, url: address, apiKey: apiKey.value })),
      );
    },
  });
  commands.scope.registerCommand({
    id: "ide.agent.web.key.clear",
    title: "Удалить ключ веб-поиска агента",
    description: "Стирает сохранённый ключ поискового сервиса штатного агента.",
    enabled: () => !busy.value && web.value.hasKey,
    run: () =>
      perform(async () =>
        adopt(
          await writeAgentWeb({ provider: web.value.provider, url: web.value.url, apiKey: null }),
        ),
      ),
  });
  onMounted(() => void perform(async () => adopt(await readAgentWeb())).catch(() => undefined));

  return { web, provider, url, apiKey, busy, error, commands };
}
