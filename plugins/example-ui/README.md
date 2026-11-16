# Example UI plugin

Независимо собираемый пример browser-плагина Projector:

- язык `Fict` для файлов `.fict` и `fictfile` — ordered regex-правила на одну строку;
- панель `Fict Inspector` в правой полосе;
- вкладка `Fict Overview` с кнопкой, которая запускает зарегистрированную команду
  `ide.editor.path.open`.

Исходник импортирует только публичный `@ai-projector/plugin-api`. Vue, CodeMirror и внутренние
модули Projector в артефакт не попадают.

## Сборка

```bash
vp run build:plugin:example-ui
```

Получается самодостаточный ESM `dist/browser.js`. Установите папку пакета через
**Настройки → Плагины → Установить из папки**, затем **Подтвердить доверие** и **Включить**:
browser-код требует явного доверия к текущему хешу содержимого.

## Контракт

`activate(api)` регистрирует только объявленные в `package.json` вклады. Собственные команды
живут в `api.commands.prefix`; в примере это `ide.plugin.command.<package-key>.greet`.
`context.commands.run("ide.editor.path.open", { path: "README.md", line: 1 })` возвращает Promise
команды editor scope, а не fire-and-forget вызов.

`api.assetUrl("chunk.js")` считает путь от каталога артефактов (`dist/`), не от корня пакета.
Регулярные правила языка применяются построчно: у них нет cross-line состояния, parser tree,
indent/fold и произвольных CodeMirror extensions.

Browser-код выполняется на origin страницы Projector/Hub с правами страницы. Это доверенный код,
не sandbox; на Hub device-aware API направляет штатные запросы, но не изолирует враждебный JS.
