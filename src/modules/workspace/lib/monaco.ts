import * as monaco from "monaco-editor/editor/editor.api.js";
import "monaco-editor/editor/contrib/documentSymbols/browser/outlineModel.js";
import "monaco-editor/editor/contrib/find/browser/findController.js";
import "monaco-editor/editor/contrib/clipboard/browser/clipboard.js";
import EditorWorker from "monaco-editor/editor/editor.worker.js?worker";
import "monaco-editor/basic-languages/monaco.contribution.js";
import JsonWorker from "monaco-editor/language/json/json.worker.js?worker";
import { jsonDefaults } from "monaco-editor/languages/features/json/register.js";
import { shallowRef } from "vue";
import {
  defaultEditorTheme,
  isEditorTheme,
  type EditorTheme,
} from "../../../../core/modules/editor-themes/index.ts";
jsonDefaults.setDiagnosticsOptions({ validate: false });

(self as typeof self & { MonacoEnvironment: monaco.Environment }).MonacoEnvironment = {
  getWorker: (_id, label) => (label === "json" ? new JsonWorker() : new EditorWorker()),
};
monaco.editor.defineTheme("projector", {
  base: "vs-dark",
  inherit: true,
  rules: [],
  colors: {
    "editor.background": "#10100f",
    "editorLineNumber.foreground": "#5c5c56",
    "editorLineNumber.activeForeground": "#d8d2c4",
    "editor.selectionBackground": "#3a3934",
    "editor.lineHighlightBackground": "#171716",
  },
});
// Gruvbox Material's muted accents, adapted to Projector's warm surfaces.
monaco.editor.defineTheme("projector-soft", {
  base: "vs-dark",
  inherit: true,
  rules: [
    { token: "", foreground: "D8D2C4" },
    { token: "comment", foreground: "8C8C84" },
    { token: "keyword", foreground: "D8A18F" },
    { token: "operator", foreground: "D8D2C4" },
    { token: "delimiter", foreground: "ABA79B" },
    { token: "string", foreground: "A9B985" },
    { token: "string.escape", foreground: "D8B580" },
    { token: "number", foreground: "C5A5B8" },
    { token: "regexp", foreground: "B5B991" },
    { token: "type", foreground: "D8B580" },
    { token: "type.identifier", foreground: "D8B580" },
    { token: "identifier", foreground: "D8D2C4" },
    { token: "tag", foreground: "D8A18F" },
    { token: "attribute.name", foreground: "A0B7AA" },
    { token: "attribute.value", foreground: "A9B985" },
    { token: "metatag", foreground: "ABA79B" },
    { token: "string.key.json", foreground: "A0B7AA" },
    { token: "string.value.json", foreground: "A9B985" },
    { token: "keyword.json", foreground: "C5A5B8" },
  ],
  colors: {
    "editor.background": "#10100f",
    "editor.foreground": "#d8d2c4",
    "editorLineNumber.foreground": "#73736b",
    "editorLineNumber.activeForeground": "#d8d2c4",
    "editorCursor.foreground": "#d8d2c4",
    "editor.selectionBackground": "#3a3934",
    "editor.inactiveSelectionBackground": "#2c2c28",
    "editor.selectionHighlightBackground": "#3a393460",
    "editor.lineHighlightBackground": "#171716",
    "editor.lineHighlightBorder": "#171716",
    "editorIndentGuide.background1": "#2c2c28",
    "editorIndentGuide.activeBackground1": "#5c5c56",
    "editorBracketHighlight.foreground1": "#d8b580",
    "editorBracketHighlight.foreground2": "#a0b7aa",
    "editorBracketHighlight.foreground3": "#c5a5b8",
    "editorBracketHighlight.foreground4": "#a9b985",
    "editorBracketHighlight.foreground5": "#d8a18f",
    "editorBracketHighlight.foreground6": "#aba79b",
    "editorBracketMatch.background": "#3a393460",
    "editorBracketMatch.border": "#73736b",
    "editor.findMatchBackground": "#61533b",
    "editor.findMatchHighlightBackground": "#61533b70",
    "editorWidget.background": "#171716",
    "editorWidget.border": "#2c2c28",
    "editorWidget.foreground": "#d8d2c4",
    "editorSuggestWidget.selectedBackground": "#3a3934",
    "editorHoverWidget.background": "#171716",
    "editorHoverWidget.border": "#2c2c28",
    focusBorder: "#8c8c84",
    "diffEditor.insertedTextBackground": "#8fbf8a20",
    "diffEditor.removedTextBackground": "#c9897a20",
    "diffEditor.insertedLineBackground": "#8fbf8a0c",
    "diffEditor.removedLineBackground": "#c9897a0c",
    "editorGutter.addedBackground": "#8fbf8a",
    "editorGutter.deletedBackground": "#c9897a",
  },
});
export const editorTheme = shallowRef<EditorTheme>(defaultEditorTheme);
export function applyEditorTheme(theme: EditorTheme) {
  editorTheme.value = theme;
  monaco.editor.setTheme(theme);
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
applyEditorTheme(defaultEditorTheme);
export function language(path: string) {
  const extension = path.split(".").at(-1)?.toLowerCase() ?? "";
  const aliases: Record<string, string> = {
    ts: "typescript",
    tsx: "typescript",
    mts: "typescript",
    cts: "typescript",
    js: "javascript",
    jsx: "javascript",
    mjs: "javascript",
    cjs: "javascript",
    vue: "html",
    svelte: "html",
    md: "markdown",
    yml: "yaml",
    py: "python",
    sh: "shell",
    bash: "shell",
    rs: "rust",
    rb: "ruby",
    h: "cpp",
    cs: "csharp",
    kt: "kotlin",
    dockerfile: "dockerfile",
  };
  if (path.split("/").at(-1) === "Dockerfile") return "dockerfile";
  return (
    aliases[extension] ??
    (monaco.languages.getLanguages().some((item) => item.id === extension)
      ? extension
      : "plaintext")
  );
}
export { monaco };
