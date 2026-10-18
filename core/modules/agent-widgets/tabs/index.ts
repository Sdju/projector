import { defineWidget } from "../../widget-catalog/index.ts";

export const tabsWidget = defineWidget({
  name: "Tabs",
  group: "layout",
  summary: "вкладки с содержимым (<Tab title>) или переключатель значения (:options)",
  props: {
    options: {
      type: "array",
      description: "строки или {value,label?,hint?}: без <Tab> это переключатель",
    },
    name: { type: "string", description: "имя поля в <Form> (только переключатель)" },
    initial: { type: "string", description: "начальное значение" },
  },
  model: { type: "string", description: "выбранная вкладка или значение" },
  slot: '<Tab title="…">…</Tab> по одной на вкладку',
  notes: [
    "Скрытая вкладка сохраняет введённое. <Tabs :options> без <Tab> — просто переключатель значения.",
  ],
  example: '<Tabs><Tab title="Данные">…</Tab><Tab title="График">…</Tab></Tabs>',
});
