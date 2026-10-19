import { defineWidget } from "../../widget-catalog/index.ts";

export const stepsWidget = defineWidget({
  name: "Steps",
  group: "data",
  summary: "этапы с отметкой готовности",
  props: {
    items: {
      type: "array",
      description: "массив объектов: title обязателен, text и done необязательны",
      required: true,
    },
  },
  example: "<Steps :items=\"[{title:'Собрать',done:true},{title:'Проверить'}]\" />",
});
