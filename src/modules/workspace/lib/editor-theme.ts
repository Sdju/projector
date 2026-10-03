import { shallowRef } from "vue";
import {
  defaultEditorTheme,
  isEditorTheme,
  type EditorTheme,
} from "../../../../core/modules/editor-themes/index.ts";

export const editorTheme = shallowRef<EditorTheme>(defaultEditorTheme);
export function applyEditorTheme(theme: EditorTheme) {
  editorTheme.value = theme;
}
let loading: Promise<void> | undefined;
export function loadEditorTheme() {
  return (loading ??= (async () => {
    const response = await fetch("/api/ide/editor");
    if (!response.ok) throw new Error("Не удалось загрузить тему редактора");
    const data = await response.json();
    if (isEditorTheme(data.theme)) applyEditorTheme(data.theme);
  })().catch((error) => {
    loading = undefined;
    throw error;
  }));
}
