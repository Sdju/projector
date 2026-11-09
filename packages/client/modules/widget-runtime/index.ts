export { default as AgentWidget } from "./ui/AgentWidget.vue";
export { splitMessage, type MessagePart } from "./split.ts";
export { answerFormSource } from "./answer.ts";
export {
  registerWidget,
  isWidgetName,
  widgetCatalog,
  answerWidgetNames,
  projectWidgetEntries,
  widgetDefinition,
  registeredWidgets,
  projectWidgetsVersion,
  type WidgetEntry,
} from "./registry.ts";
export { ensureProjectWidgets, refreshProjectWidgets } from "./project.ts";
export {
  readProjectWidgets,
  readProjectWidgetData,
  writeProjectWidgetTrust,
} from "./project-api.ts";
export { useWidgetReply, widgetReplyKey, formatWidgetReply, type WidgetReply } from "./bridge.ts";
export { formPresetKey, formChromeKey, type FormPreset, type FormChrome } from "./form.ts";
export { useMessageScope, messageScopeKey, widgetProjectKey, type MessageScope } from "./scope.ts";
export { autoClose, parseWidgetSource } from "./autoclose.ts";
export {
  answerProblem,
  dedupeAttributes,
  doctorAnswerSource,
  doctorFormSource,
  formProblem,
  heuristicFormRepair,
} from "./repair.ts";
