import { registerAgentFeature, registerFeatureAgent } from "../modules/agent-features/index.ts";
import { listAgentBackends } from "../modules/agent/index.ts";
import { widgetCatalog } from "../modules/agents/projector/index.ts";

/** What the widgets are for: the components themselves come from the catalog at call time. */
const WIDGETS_INTRO =
  "Отчёты, дашборды, сводки, графики, калькуляторы и формы выбора в ответе — это не разработка кода проекта: собирай их сам и не отсылай к другому агенту. Вставляй Vue-компоненты прямо в markdown, когда это нагляднее текста (цифры, динамика, сравнения, настройки, выбор). Обычные вопросы компонентами не загромождай.";

/**
 * The IDE commands are one MCP server with three tools, not one tool per feature: the live
 * catalog is the source of truth, exactly as it is for the built-in Projector agent.
 */
const IDE_INTRO =
  "Управление IDE. В этом чате доступны команды Projector: `list_commands`, `describe_command` и `execute_command` (у внешних агентов они приходят через MCP-сервер `projector-ide`). Не выдумывай команды и аргументы: сначала `list_commands` (пустой query — весь каталог проекта), затем `describe_command` для выбранной пары command и scope, и только потом `execute_command` с теми же command и scope. Изменяющие команды Projector спрашивают подтверждение в окне Projector. Открывай файлы и вкладки, работай с Git, настройками, терминалами и чатами командами Projector, а не дублируй их shell-командами, если подходящая команда есть.";

/**
 * The optional abilities the chat can give to an agent. The composition is the only place that
 * names them, like the widgets; `registerBuiltinWidgetDefinitions` has to run first, because the
 * instruction reads the live catalog.
 */
export function registerBuiltinAgentFeatures(): void {
  const backends = listAgentBackends();
  for (const agent of backends) registerFeatureAgent({ id: agent.id, label: agent.label });
  registerAgentFeature({
    id: "widgets",
    title: "Виджеты в ответах",
    summary: "Графики, показатели, вкладки и формы прямо в markdown-ответе.",
    defaults: backends.filter(({ builtin }) => builtin).map(({ id }) => id),
    instruction: () => `Виджеты в ответах. ${WIDGETS_INTRO}\n\n${widgetCatalog.guide()}`,
  });
  registerAgentFeature({
    id: "ide",
    title: "Команды IDE через MCP",
    summary: "Агент открывает файлы и вкладки, работает с Git и настройками командами Projector.",
    // Off until the user asks for it: the server can change files, Git and Projector itself.
    defaults: [],
    instruction: () => `Команды IDE. ${IDE_INTRO}`,
  });
}
