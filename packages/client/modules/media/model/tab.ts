import { singletonTab } from "../../workspace-api/index.ts";

/** Вкладка генерации медиа: живёт в workspace, а не в настройках. */
export const mediaTab = singletonTab("media", "media:generate", "Медиа", "Генерация медиа", {
  subtitle: "медиа",
  command: {
    id: "ide.media.open",
    title: "Открыть генерацию медиа",
    description:
      "Открывает вкладку генерации изображений, речи, распознавания и видео. Модели берутся у включённых провайдеров с медиа-адаптером; повторный вызов фокусирует существующую вкладку.",
  },
});
