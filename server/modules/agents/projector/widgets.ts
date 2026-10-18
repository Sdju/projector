import {
  createWidgetCatalog,
  type WidgetDefinition,
} from "../../../../core/modules/widget-catalog/index.ts";

/** What the assistant is told about the chat's components; filled by the composition at startup. */
export const widgetCatalog = createWidgetCatalog();

export const registerWidgetDefinition = (definition: WidgetDefinition): void =>
  widgetCatalog.register(definition);
