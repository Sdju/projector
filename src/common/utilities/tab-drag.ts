import { shallowRef } from "vue";

/**
 * Перетаскиваемая вкладка. dataTransfer недоступен для чтения во время dragover,
 * поэтому полосы вкладок и блоки раскладки сверяются с общим состоянием.
 */
export const tabDrag = shallowRef<{ id: string; group: string } | undefined>();
