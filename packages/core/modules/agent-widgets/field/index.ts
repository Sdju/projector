import { defineWidget } from "../../widget-catalog/index.ts";

export const fieldWidget = defineWidget({
  name: "Field",
  group: "form",
  summary: "поле формы; type задаёт вид контроля",
  props: {
    type: {
      type: "string",
      description:
        "text, textarea, number, slider, select, radio, checks, switch, date, time или segmented; по умолчанию text",
    },
    name: { type: "string", description: "имя поля в Form" },
    label: { type: "string", description: "подпись поля" },
    hint: { type: "string", description: "пояснение под полем" },
    initial: {
      type: "string | number | boolean | array",
      description: "начальное значение; для checks — массив, для switch — boolean",
    },
    placeholder: { type: "string", description: "подсказка в пустом text, textarea или number" },
    required: { type: "boolean", description: "обязательное поле" },
    disabled: { type: "boolean", description: "заблокировать поле" },
    options: {
      type: "array",
      description: "для select, radio и checks: строки или {value, label, hint}",
    },
    min: { type: "number", description: "минимум для number и slider" },
    max: { type: "number", description: "максимум для number и slider" },
    step: { type: "number", description: "шаг для number и slider" },
    unit: { type: "string", description: "единица рядом со значением number и slider" },
    rows: { type: "number", description: "высота textarea в строках" },
  },
  model: { type: "string | number | boolean | array", description: "значение поля" },
  guide: [
    "type: text | textarea | number | slider | select | radio | checks | switch | date | time | segmented.",
    "Общие: name, label, hint, initial, placeholder, required, disabled.",
    "options — для select/radio/checks; min/max/step/unit — для number/slider; rows — для textarea.",
    "checks отдаёт array, switch — boolean, number/slider — number, остальные — string.",
  ].join("\n"),
  example:
    '<Field type="select" name="mode" label="Режим" :options="[\'server\',\'window\']" />\n<Field type="slider" name="port" label="Порт" :min="3000" :max="9000" :initial="4177" />',
});
