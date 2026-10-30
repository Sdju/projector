import { registerAgentFeature, registerFeatureAgent } from "../modules/agent-features/index.ts";
import { widgetCatalog } from "../modules/agents/projector/index.ts";

/** The agents a feature can be switched on for; ids match the registered chat backends. */
const AGENTS = [
  { id: "projector", label: "Projector" },
  { id: "claude-code", label: "Claude Code" },
  { id: "codex", label: "Codex" },
  { id: "opencode", label: "OpenCode" },
  { id: "cursor", label: "Cursor" },
  { id: "kimi", label: "Kimi" },
];

/** What the widgets are for: the components themselves come from the catalog at call time. */
const WIDGETS_INTRO =
  "Отчёты, дашборды, сводки, графики, калькуляторы и формы выбора в ответе — это не разработка кода проекта: собирай их сам и не отсылай к другому агенту. Вставляй Vue-компоненты прямо в markdown, когда это нагляднее текста (цифры, динамика, сравнения, настройки, выбор). Обычные вопросы компонентами не загромождай.";

/**
 * The optional abilities the chat can give to an agent. The composition is the only place that
 * names them, like the widgets; `registerBuiltinWidgetDefinitions` has to run first, because the
 * instruction reads the live catalog.
 */
export function registerBuiltinAgentFeatures(): void {
  for (const agent of AGENTS) registerFeatureAgent(agent);
  registerAgentFeature({
    id: "widgets",
    title: "Виджеты в ответах",
    summary: "Графики, показатели, вкладки и формы прямо в markdown-ответе.",
    defaults: ["projector"],
    instruction: () => `Виджеты в ответах. ${WIDGETS_INTRO}\n\n${widgetCatalog.guide()}`,
  });
}
