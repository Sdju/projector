import { defineWidget } from "../../widget-catalog/index.ts";

export const tabsWidget = defineWidget({
  name: "Tabs",
  group: "layout",
  summary: "вкладки с содержимым в компонентах Tab",
  props: {
    options: {
      type: "array",
      description:
        "массив строк или объектов: value обязателен, label и hint необязательны; без дочерних Tab это устаревший переключатель",
    },
    name: { type: "string", description: "имя поля в <Form> (устаревший переключатель)" },
    initial: { type: "string", description: "начальное значение (устаревший переключатель)" },
  },
  model: { type: "string", description: "выбранная вкладка или значение" },
  slot: "дочерний компонент Tab с названием title и содержимым для каждой вкладки",
  notes: [
    "Скрытая вкладка сохраняет введённое. Для переключателя значения используй Field с type=segmented или radio.",
  ],
  guide: [
    "Дочерние Tab с title; скрытая вкладка сохраняет введённое.",
    "Для выбора значения используй Field type=segmented или radio.",
  ].join("\n"),
  example:
    '<Tabs><Tab title="Данные">Значения за месяц</Tab><Tab title="Итоги">Всего 100</Tab></Tabs>',
});
