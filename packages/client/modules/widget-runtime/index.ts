export { default as AgentWidget } from "./ui/AgentWidget.vue";
export { splitMessage, type MessagePart } from "./split.ts";
export { answerFormSource } from "./answer.ts";
export { registerWidget, isWidgetName, widgetCatalog, type WidgetEntry } from "./registry.ts";
export { useWidgetReply, widgetReplyKey, formatWidgetReply, type WidgetReply } from "./bridge.ts";
export { formPresetKey, formChromeKey, type FormPreset, type FormChrome } from "./form.ts";
export { useMessageScope, messageScopeKey, type MessageScope } from "./scope.ts";
export { autoClose, parseWidgetSource } from "./autoclose.ts";
export { dedupeAttributes, doctorFormSource, formProblem, heuristicFormRepair } from "./repair.ts";
