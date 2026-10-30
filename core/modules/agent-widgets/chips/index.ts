import { defineWidget } from "../../widget-catalog/index.ts";

export const chipsWidget = defineWidget({
  name: "Chips",
  group: "data",
  summary: "набор цветных меток: теги, статусы, технологии",
  props: {
    items: {
      type: "string | {label, tone?, icon?}[]",
      description:
        "метки; tone — neutral, info, success, warning, danger или accent; icon — имя из InlineIcon. Без tone цвета чередуются автоматически",
      required: true,
    },
    mono: { type: "boolean", description: "моноширинный шрифт для кода, хешей и версий" },
  },
  example: `<Chips :items="['TypeScript',{label:'готово',tone:'success',icon:'circle-check'},{label:'риск',tone:'warning',icon:'alert'}]" />`,
});
