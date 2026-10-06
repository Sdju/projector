import { useMediaQuery } from "@vueuse/core";

/** Узкий экран или телефон в ландшафте: интерфейс переходит на мобильную компоновку. */
export const compactViewportQuery =
  "(max-width: 700px), (max-width: 1050px) and (max-height: 500px) and (pointer: coarse)";

export const useCompactViewport = () => useMediaQuery(compactViewportQuery);
