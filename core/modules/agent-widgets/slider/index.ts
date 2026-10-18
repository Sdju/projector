import { defineWidget } from "../../widget-catalog/index.ts";

export const sliderWidget = defineWidget({
  name: "Slider",
  group: "form",
  summary: "число на шкале",
  props: {
    label: { type: "string", description: "подпись" },
    min: { type: "number", description: "минимум, по умолчанию 0" },
    max: { type: "number", description: "максимум, по умолчанию 100" },
    step: { type: "number", description: "шаг" },
    unit: { type: "string", description: "единица рядом со значением" },
    name: { type: "string", description: "имя поля в <Form>" },
    initial: { type: "number", description: "начальное значение, по умолчанию min" },
  },
  model: { type: "number", description: "текущее значение" },
  example: '<Slider name="port" label="Порт" :min="3000" :max="9000" unit="" :initial="4000" />',
});
