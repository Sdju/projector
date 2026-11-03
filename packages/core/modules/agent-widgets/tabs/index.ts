import { defineWidget } from "../../widget-catalog/index.ts";

export const tabsWidget = defineWidget({
  name: "Tabs",
  group: "layout",
  summary:
    "вкладки с содержимым в компонентах Tab или переключатель значения через свойство options",
  props: {
    options: {
      type: "array",
      description:
        "массив строк или объектов: value обязателен, label и hint необязательны; без дочерних Tab это переключатель",
    },
    name: { type: "string", description: "имя поля в <Form> (только переключатель)" },
    initial: { type: "string", description: "начальное значение" },
  },
  model: { type: "string", description: "выбранная вкладка или значение" },
  slot: "дочерний компонент Tab с названием title и содержимым для каждой вкладки",
  notes: [
    "Скрытая вкладка сохраняет введённое. Tabs со свойством options без дочерних Tab — переключатель значения.",
  ],
  example:
    '<Tabs><Tab title="Данные">Значения за месяц</Tab><Tab title="Итоги">Всего 100</Tab></Tabs>',
});
