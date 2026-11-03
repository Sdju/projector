import type { OpenFile } from "../open-file.ts";

/** Откроется ли файл как предпросмотр: уже закреплённая вкладка предпросмотром не становится. */
export function opensAsPreview(requested: boolean, existing?: OpenFile) {
  return requested && (!existing || !!existing.preview);
}

/** Новая вкладка предпросмотра вытесняет прежнюю; изменённую или сохраняемую — закрепляет. */
export function dropPreviewExcept(
  tabs: OpenFile[],
  key: string,
  isDirty: (file: OpenFile) => boolean,
  release: (file: OpenFile) => void,
) {
  for (const tab of [...tabs]) {
    if (!tab.preview || tab.key === key) continue;
    if (isDirty(tab) || tab.saving) tab.preview = false;
    else {
      release(tab);
      tabs.splice(tabs.indexOf(tab), 1);
    }
  }
}
