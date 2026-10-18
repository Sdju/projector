import { defineWidget } from "../../widget-catalog/index.ts";

export const statWidget = defineWidget({
  name: "Stat",
  group: "data",
  summary: "показатель: подпись, значение, изменение",
  props: {
    label: { type: "string", description: "подпись", required: true },
    value: { type: "string | number", description: "значение", required: true },
    delta: { type: "number", description: "изменение в процентах, знак задаёт цвет" },
    hint: { type: "string", description: "пояснение мелким шрифтом" },
  },
  example: '<Stat label="Выручка" value="4,2 млн" :delta="12" hint="к прошлому кварталу" />',
});
