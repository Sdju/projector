import { defineWidget } from "../../widget-catalog/index.ts";

export const checksWidget = defineWidget({
  name: "Checks",
  group: "form",
  summary: "выбор из списка: несколько (флажки) или один (single)",
  props: {
    options: {
      type: "array",
      description: "массив строк или объектов: value обязателен, label и hint необязательны",
      required: true,
    },
    single: { type: "boolean", description: "один вариант вместо нескольких" },
    name: { type: "string", description: "имя поля в <Form>" },
    initial: { type: "array", description: "начально выбранные value" },
  },
  model: { type: "array", description: "выбранные value" },
  example:
    "<Checks name=\"scripts\" :initial=\"['test']\" :options=\"[{value:'start',hint:'dev-сервер'},'test']\" />",
});
