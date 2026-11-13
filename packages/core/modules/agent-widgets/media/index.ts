import { defineWidget } from "../../widget-catalog/index.ts";

export const mediaWidget = defineWidget({
  name: "Media",
  group: "data",
  summary: "медиа из API: сам читает задачу или файл и показывает картинку, аудио, видео или текст",
  special: true,
  props: {
    jobId: {
      type: "string",
      description:
        "id задачи из ide.media.generate: виджет читает /api/media/jobs/:id и опрашивает её",
    },
    fileId: {
      type: "string",
      description: "id скачанного файла; нужен, когда задачи уже нет после перезапуска сервера",
    },
    kind: {
      type: '"image" | "audio" | "video" | "text"',
      description: "вид файла для fileId, по умолчанию image",
    },
    alt: { type: "string", description: "текстовое описание для доступности" },
    caption: { type: "string", description: "подпись под медиа" },
    height: {
      type: "number",
      description: "высота картинки или видео в пикселях, по умолчанию 240",
    },
  },
  notes: [
    "Укажите `jobId` или `fileId`; если есть оба, читается задача.",
    "Пока задача в статусе queued или running, виджет сам опрашивает её раз в полторы секунды.",
    "Задачи живут в памяти сервера, а скачанные файлы остаются: после перезапуска используйте `fileId` с `kind`.",
    "Если у задачи несколько артефактов, показываются все: изображение, аудио, видео и текст распознавания.",
    "Готовый тег уже приходит в поле `widget` результата `ide.media.generate` — вставляйте его как есть.",
  ],
  example: '<Media jobId="e3e7…" caption="Кот в окне" />',
});
