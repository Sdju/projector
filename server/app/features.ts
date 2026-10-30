import { registerAgentFeature, registerFeatureAgent } from "../modules/agent-features/index.ts";
import { listAgentBackends } from "../modules/agent/index.ts";
import { widgetCatalog } from "../modules/agents/projector/index.ts";

/** What the widgets are for: the components themselves come from the catalog at call time. */
const WIDGETS_INTRO =
  "Отчёты, дашборды, сводки, графики, калькуляторы и формы выбора в ответе — это не разработка кода проекта: собирай их сам и не отсылай к другому агенту. Вставляй Vue-компоненты прямо в markdown, когда это нагляднее текста (цифры, динамика, сравнения, настройки, выбор). Обычные вопросы компонентами не загромождай.";

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
}
