import { defineWidget } from "../../widget-catalog/index.ts";

export const imageWidget = defineWidget({
  name: "Image",
  group: "data",
  summary: "изображение с подписью",
  props: {
    src: { type: "string", description: "URL изображения или data: URI", required: true },
    alt: { type: "string", description: "текстовое описание для доступности", required: true },
    caption: { type: "string", description: "подпись под изображением" },
    fit: { type: '"contain" | "cover"', description: "вписывание в рамку, по умолчанию contain" },
    height: { type: "number", description: "высота в пикселях, по умолчанию 240" },
  },
  example:
    '<Image src="https://example.com/chart.png" alt="График продаж" caption="Продажи за квартал" fit="contain" :height="240" />',
});
