import * as monaco from "monaco-editor/editor/editor.api.js";
import "monaco-editor/editor/contrib/documentSymbols/browser/outlineModel.js";
import "monaco-editor/editor/contrib/find/browser/findController.js";
import "monaco-editor/editor/contrib/clipboard/browser/clipboard.js";
import EditorWorker from "monaco-editor/editor/editor.worker.js?worker";
import "monaco-editor/basic-languages/monaco.contribution.js";
import JsonWorker from "monaco-editor/language/json/json.worker.js?worker";
import { jsonDefaults } from "monaco-editor/languages/features/json/register.js";
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
