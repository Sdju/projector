import { defineWidget } from "../../widget-catalog/index.ts";

export const tabWidget = defineWidget({
  name: "Tab",
  group: "layout",
  summary: "одна вкладка внутри <Tabs>",
  props: {
    title: { type: "string", description: "название вкладки", required: true },
    hint: { type: "string", description: "подсказка при наведении" },
  },
  slot: "содержимое вкладки",
  example: '<Tab title="Данные">…</Tab>',
});
