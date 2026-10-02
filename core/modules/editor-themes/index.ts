export const editorThemes = [
  {
    id: "projector-soft",
    title: "Projector · Gruvbox Material",
    description: "Приглушённые тёплые цвета на фоне Projector. Рекомендуемая тема.",
  },
  {
    id: "projector",
    title: "Projector · классическая",
    description: "Прежняя подсветка на тёмном фоне Projector.",
  },
  { id: "vs-dark", title: "VS Dark", description: "Стандартная тёмная тема Monaco." },
  { id: "vs", title: "VS Light", description: "Светлая тема Monaco." },
  { id: "hc-black", title: "Высокий контраст", description: "Чёрный фон и контрастные цвета." },
] as const;
export type EditorTheme = (typeof editorThemes)[number]["id"];
export const defaultEditorTheme: EditorTheme = "projector-soft";
export function isEditorTheme(value: unknown): value is EditorTheme {
  return editorThemes.some((theme) => theme.id === value);
}
