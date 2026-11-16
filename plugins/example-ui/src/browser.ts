import {
  definePlugin,
  LanguageRule,
  Plugin,
  PluginApi,
  PluginViewContext,
} from "@ai-projector/plugin-api";

const rules: LanguageRule[] = [
  { pattern: "\\s+", token: undefined },
  { pattern: "//[^\\n]*", token: "comment" },
  { pattern: '"(?:[^"\\\\]|\\\\.)*"', token: "string" },
  { pattern: "\\b(?:let|fn|if|else|return|import|export)\\b", token: "keyword" },
  { pattern: "\\b(?:true|false)\\b", token: "bool" },
  { pattern: "\\b\\d+(?:\\.\\d+)?\\b", token: "number" },
  { pattern: "[{}()\\[\\];,]", token: "punctuation" },
  { pattern: "(?:==|!=|<=|>=|->|[+\\-*/%=<>])", token: "operator" },
  { pattern: "[A-Za-z_][A-Za-z0-9_]*", token: "variableName" },
];

function text(container: HTMLElement, content: string, className?: string): HTMLElement {
  const element = container.ownerDocument.createElement("div");
  if (className) element.className = className;
  element.textContent = content;
  container.append(element);
  return element;
}

function mountPanel(container: HTMLElement, context: PluginViewContext): () => void {
  container.replaceChildren();
  const title = text(container, "Fict Inspector", "example-plugin-title");
  title.style.fontWeight = "600";
  const lines = text(container, `Проект: ${context.projectId}`);
  lines.style.color = "var(--muted)";
  const hint = text(
    container,
    "Файлы .fict подсвечиваются плагином. Панель живёт, пока плагин включён.",
  );
  hint.style.whiteSpace = "pre-wrap";
  return () => {
    container.replaceChildren();
  };
}

function mountTab(container: HTMLElement, context: PluginViewContext): () => void {
  container.replaceChildren();
  const title = text(container, "Fict Overview", "example-plugin-title");
  title.style.fontWeight = "600";
  text(
    container,
    "Это обычная вкладка плагина: состояние сохраняется при скрытии и переносе, dispose вызывается при закрытии.",
  );
  const button = container.ownerDocument.createElement("button");
  button.type = "button";
  button.textContent = "Открыть README.md";
  button.addEventListener(
    "click",
    () => void context.commands.run("ide.editor.path.open", { path: "README.md", line: 1 }),
  );
  container.append(button);
  return () => {
    container.replaceChildren();
  };
}

const plugin = definePlugin({
  apiVersion: 1,
  activate(api: PluginApi) {
    api.languages.register({ id: "fict", rules });
    api.panels.register({ id: "inspector", mount: mountPanel });
    api.tabs.register({ id: "overview", mount: mountTab });
    api.commands.register({
      id: api.commands.prefix + "greet",
      title: "Пример плагина: приветствие",
      description: "Проверяет регистрацию собственной команды плагина в workspace.",
      run: () => ({ plugin: api.packageName, project: api.device }),
    });
    api.onDispose(() => {
      // Placeholder for timers, observers or network subscriptions of a real plugin.
    });
  },
});

export default plugin;
