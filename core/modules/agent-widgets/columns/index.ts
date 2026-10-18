import { defineWidget } from "../../widget-catalog/index.ts";

export const columnsWidget = defineWidget({
  name: "Columns",
  group: "layout",
  summary: "колонки; на узкой ширине встают в столбик",
  props: {
    cols: { type: "number", description: "число колонок, по умолчанию 2" },
    gap: { type: "number", description: "отступ в пикселях" },
  },
  slot: "элементы по колонкам",
  example: '<Columns :cols="2"><Line … /><Bars … /></Columns>',
});
