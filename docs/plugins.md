# Локальные плагины

Projector поддерживает локальные плагины: цветовые схемы интерфейса, декларативных ACP-агентов и доверенный браузерный UI с подсветкой новых языков, панелями и вкладками. По умолчанию пакет состоит из `package.json` и JSON-файлов; JavaScript загружается только после явного доверия к текущему хешу содержимого. Управление находится в **Настройки → Плагины**: там можно установить папку, включить или выключить пакет, подтвердить доверие к коду, посмотреть диагностику, применить тему и удалить управляемую установку.

Исполняемый код бывает двух видов: `projector.server` — CommonJS-модуль в процессе Projector, и `projector.browser` — ESM-модуль на origin страницы. Агентский плагин запускает внешнюю команду на машине пользователя. Все три вида включаются только после доверия к хешу пакета. Ни один из них не является песочницей; произвольные Node-возможности и установка из реестра npm по-прежнему не выдаются.

## Манифест

Манифестом служит `package.json` в корне пакета. Поддерживается ровно следующая структура; неизвестные поля отклоняются:

```json
{
  "name": "@example/sepia",
  "version": "1.0.0",
  "description": "Тёплая светлая схема",
  "engines": {
    "projector": ">=0.11.0"
  },
  "projector": {
    "apiVersion": 1,
    "contributes": {
      "themes": [
        {
          "id": "paper",
          "title": "Sepia Paper",
          "description": "Светлая бумажная тема",
          "mode": "light",
          "tokens": "themes/paper.json"
        }
      ]
    }
  }
}
```

- `name` обязателен: обычное или scoped npm-имя в нижнем регистре (`example-theme` или `@example/theme`), максимум 214 символов. Это ID плагина.
- `version` обязателен и должен быть semver `x.y.z`, с необязательными prerelease/build-частями.
- `description` и `engines.projector` необязательны. Проверяется совместимость с текущей версией Projector; поддерживаются `*`, `latest`, сравнения, `^`, `~`, пробелы между условиями и `||`.
- `projector.apiVersion` обязателен и сейчас равен только `1`; это версия контракта автора.
- `projector.server` необязателен и указывает на собранный CommonJS-модуль; он допустим только вместе с `contributes.agents`.
- `projector.browser` необязателен и указывает на собранный ESM-модуль, например `dist/browser.js`. Entry обязан лежать в подкаталоге артефактов (не в корне пакета), а все относительные chunks и ассеты — рядом с ним.
- `projector.contributes` содержит хотя бы один непустой вклад: `themes`, `agents`, `languages`, `panels` или `tabs`.
- `projector.contributes.themes` необязателен; если он есть, каждая тема проверяется по правилам ниже.
- `projector.contributes.agents` необязателен; агент описывается декларативно и запускается через ACP.
- `projector.contributes.languages` объявляет метаданные языка без исполнения JS: `id`, `title`, необязательные `description`, `extensions`, `filenames` и `priority` (от -1000 до 1000). Нужен хотя бы один из `extensions`/`filenames`; расширения и имена файлов ограничены безопасным алфавитом.
- `projector.contributes.panels` объявляет панели: `id`, `title`, необязательное `description` и `placement` — `sidebar` или `aside`.
- `projector.contributes.tabs` объявляет служебные вкладки: `id`, `title`, необязательное `description`.
- Локальные `id` вкладов уникальны внутри своей категории. Полный id в интерфейсе namespaced именем пакета; встроенные вкладки и панели не заменяются.
- Ограничения: до 50 вкладов каждой категории, до 20 расширений/имён файлов у языка, до 200 правил грамматики; длина пути entry — до 300 символов.
- У темы обязательны уникальный внутри пакета `id` (`a-z`, `0-9`, `.`, `_`, `-`, начинается с буквы или цифры), `title`, `mode` (`dark` или `light`) и `tokens`. `description` необязателен.
- `tokens` — относительный путь к `.json` внутри пакета. Абсолютные пути, `.`/`..` в сегментах и симлинки запрещены; файл должен быть обычным файлом.

Полный ID внешней темы — `<package>/<theme>`, например `@example/sepia/paper`. Он сохраняется как выбор оформления в `appearance.json`.

Пакет только с браузерными вкладами выглядит так:

```json
{
  "name": "@example/fict",
  "version": "1.0.0",
  "type": "module",
  "projector": {
    "apiVersion": 1,
    "browser": "dist/browser.js",
    "contributes": {
      "languages": [
        {
          "id": "fict",
          "title": "Fict",
          "extensions": [".fict"],
          "filenames": ["fictfile"],
          "priority": 10
        }
      ],
      "panels": [{ "id": "inspector", "title": "Fict Inspector", "placement": "aside" }],
      "tabs": [{ "id": "overview", "title": "Fict Overview" }]
    }
  }
}
```

## Агенты

Агент плагина — декларативный ACP-агент. Projector запускает его команду и говорит с ней по Agent Client Protocol; диалекты, формы, plan readers и произвольный код не поддерживаются.

```json
{
  "name": "@example/agent",
  "version": "1.0.0",
  "projector": {
    "apiVersion": 1,
    "contributes": {
      "agents": [
        {
          "id": "example-agent",
          "title": "Example Agent",
          "caption": "Запустит Example через ACP",
          "icon": "sparkles",
          "program": "example-agent",
          "terminal": { "executable": "example-agent", "title": "Example" },
          "command": "example-agent",
          "args": ["acp"],
          "binary": "example-agent"
        }
      ]
    }
  }
}
```

- `id` — уникальный идентификатор агента и backend id; `program` по умолчанию равен `id` и не должен совпадать с другим агентом или терминалом.
- `command` и `args` — argv-массив без shell-строки, переводов строк и NUL. Команда запускается на машине пользователя.
- `icon` — имя из короткого allowlist (`bot`, `code`, `sparkles`, `terminal`) или относительный путь к SVG внутри пакета (`icons/cursor.svg`). Неизвестное имя даёт запасную иконку; SVG проходит санитизацию и рисуется на кнопке «+» и в индикаторе лимитов.
- `terminal` необязателен: `executable` и `title` по умолчанию берутся из `program` и `title`.
- `clientCapabilities` необязателен и передаётся в ACP `initialize`.
- `usage` необязателен: `{"kind":"command","command":"...","args":["usage","--json"],"timeoutMs":10000}`. Projector запускает argv-команду, читает JSON `{status, checkedAt, windows}` и показывает общий индикатор лимитов. Окна: `rolling`, `weekly`, `monthly`, `daily`; каждое — `{usedPercent, resetsAt?, limited?}`. Ошибка, таймаут или неверный JSON дают явное «лимиты недоступны» и не влияют на чат.
- Токенная аналитика необязательна: агент может отправить ACP-уведомление `projector/usage` с `{input, output, cacheRead, cacheWrite, model?, cost?}`. Projector сохранит его как `usage` ответа, и агент попадёт в `by-agent`, `by-model` и heatmap. Без уведомления и без нативного журнала токенов у агента нет.
- `usageReporting` зарезервирован схемой и пока не влияет на поведение.
- `capabilities`, `env`, `secrets`, `dialect`, `extensions`, `forms`, `plan`, `settings` и `shell` запрещены.

Пакет с `browser`, `server` или агентами после установки остаётся выключенным. Сначала пользователь подтверждает доверие к текущему содержимому пакета; в `plugins.json` сохраняется хеш. Если файлы изменились, включать пакет нужно после повторного подтверждения. Коллизия id или `program` со встроенным агентом не заменяет его, а показывает диагностику.

## Доверенный серверный код

Декларативного ACP достаточно для обычных агентов, но Cursor добавляет свой диалект, extensions и нормализацию выбора. Для таких пакетов есть отдельный, более высокий уровень доверия: поле `projector.server` указывает на собранный CommonJS-модуль внутри пакета, например `dist/server.cjs`.

```json
{
  "projector": {
    "apiVersion": 1,
    "server": "dist/server.cjs",
    "contributes": {
      "agents": [
        {
          "id": "cursor",
          "title": "Cursor",
          "command": "agent",
          "args": ["acp"],
          "program": "cursor"
        }
      ]
    }
  }
}
```

Модуль экспортирует `createAgents(api)` и возвращает массив агентов:

```js
exports.createAgents = (api) => [
  api.createAcpBackend({
    id: "cursor",
    label: "Cursor",
    command: "agent",
    args: ["acp"],
    dialect: () => api.acp.extendPlainDialect({}),
  }),
];
```

`api` версии `1` даёт `createAcpBackend(program)` и `api.acp` с `createPlainDialect`, `extendPlainDialect`, `inputOf`, `isOver`, `readCompaction`, `shorten` и `uuidV7Time`. Типы для автора лежат в `packages/server/modules/plugin-api`; их импортируют только через `import type`, чтобы собранный плагин не зависел от внутренних путей Projector. Готовый пример — [`plugins/cursor`](../plugins/cursor), сборка — `vp run build:plugin:cursor`.

Доверенный код может сам отдавать лимиты подписки: `backend.usage = { kind: "function", read(checkedAt) }`, а `backend.usageWindows` задаёт подписи и длительность окон (`name`, `label`, `shortLabel`, `periodSeconds`, необязательные `ticks`). Projector выставляет общий маршрут `/api/agent/usage/<id>`, кеширует ответ и рисует его тем же индикатором, что и декларативный `usage.command`; без плагина маршрут отвечает «агент не сообщает лимиты». Так Cursor отдаёт свои окна «Всего / Авто / API» из `plugins/cursor`, а не из встроенного модуля. Список задач чата задаётся тем же кодом: `backend.plan = { tools: ["create_plan", "update_todos"] }` — клиент читает `{ todos }` этих вызовов общим reader'ом, без модуля агента в `packages/client`.

Токенную аналитику плагин тоже приносит с собой: `backend.usageLog` принимает `UsageLogReader` (`agent`, `label`, `roots()`, `files()`, `read()` и необязательные `append`/`maxBytes`). Projector регистрирует читатель вместе с агентом, сканирует его журналы в общую вкладку «Аналитика расхода» и снимает читатель при выключении плагина. Читатель возвращает метаданные — время, модель, каталог, токены и необязательную стоимость; промпты и вывод инструментов не индексируются. Встроенные Codex, OpenCode и Kimi и пример Cursor используют ровно этот путь.

Код выполняется **в процессе сервера с его правами**, без песочницы. Поэтому он загружается только после явного доверия и включения пакета, а изменение любого файла пакета снимает доверие. Этот API не выдаёт браузерный UI и внутренние модули клиента: для UI есть отдельный `projector.browser`, а для изоляции всё ещё нужен будущий отдельный runtime/процесс.

## Браузерный код и UI

`projector.browser` — готовый ESM-модуль, собранный автором отдельно. Установка копирует артефакт и не запускает `install`/`build` скрипты. Модуль экспортирует `default` (или `plugin`) с `apiVersion: 1` и `activate(api)`. Хост передаёт реализацию API аргументом; глобального объекта Projector нет. Публичные типы автора — пакет `@ai-projector/plugin-api` (`packages/plugin-api/modules/api/index.ts`), он не импортирует клиентские или серверные реализации.

```ts
import { definePlugin, type PluginApi } from "@ai-projector/plugin-api";

export default definePlugin({
  apiVersion: 1,
  activate(api: PluginApi) {
    api.languages.register({
      id: "fict", // id из projector.contributes.languages
      rules: [
        { pattern: "\\s+" },
        { pattern: "//[^\\n]*", token: "comment" },
        { pattern: '"([^"\\\\]|\\\\.)*"', token: "string" },
        { pattern: "\\b(let|fn|return)\\b", token: "keyword" },
      ],
    });
    api.panels.register({ id: "inspector", mount }); // placement задан манифестом
    api.tabs.register({ id: "overview", mount });
    api.commands.register({
      id: api.commands.prefix + "format",
      title: "Форматировать Fict",
      description: "Собственное действие плагина в палитре команд.",
      run: () => undefined,
    });
    api.onDispose(() => cleanup());
  },
});
```

`activate` может быть async и возвращать `Disposable` или функцию очистки. Все регистрации принадлежат scope активации: `api.signal` прерывается, `api.onDispose` и возвращённый disposer вызываются при disable, remove, смене хеша, уходе со страницы или HMR. Частично упавшая активация снимает уже созданные вклады; исключение в одном disposer не мешает остальным. Повторный enable создаёт новый scope; модуль может остаться в кеше браузера, поэтому обязательные регистрации нужно делать в `activate`, а не на верхнем уровне.

Собственные команды плагина живут в reserved-пространстве `api.commands.prefix` (`ide.plugin.command.<package-key>.`): так пакет не может занять встроенную команду или команду открытия чужой панели/вкладки. `title` и `description` обязательны.

### Языки

Грамматика — сериализуемые правила, а не CodeMirror extension: массив `{ pattern, token? }` применяется по порядку к текущей позиции **строки**. `pattern` — JavaScript-регулярное выражение без пустого совпадения, `token` — один из стандартных имён (`keyword`, `string`, `comment`, `number`, `typeName`, `functionName`, `propertyName`, `operator`, `punctuation`, `meta` и т. п.) или пусто для пробелов; `caseInsensitive` включает регистронезависимый режим. Правила не видят соседние строки, не задают indent/fold/parser tree и не заменяют язык целиком: для сложной грамматики нужен будущий shared-dependency механизм. Хост сам компилирует правила, создаёт `StreamLanguage` своим экземпляром CodeMirror и передаёт его в `Compartment`. Поэтому Vue и CodeMirror не дублируются в bundle плагина, а произвольные CM extensions не выдаются.

Расширения/имена файлов берутся из манифеста. При совпадении побеждает больший `priority`, затем имя пакета и id. Без совпадения используется встроенный `@codemirror/language-data`. При включении и выключении плагина уже открытый `CodeViewer` переконфигурирует только языковой `Compartment`: `EditorView`, undo и selection сохраняются; устаревший async-результат не применяется. Статусная строка использует тот же resolver и после disable возвращается к встроенному языку.

### Панели и вкладки

`mount(container, context)` создаёт UI выбранным плагином способом и возвращает disposer; Vue не обязателен. `context` содержит `projectId`, `device`, `signal`, `params`, `assetUrl(relative)`, `commands.run(ide.*)`, `workspace.openFile(path, options)` и `workspace.openTab(id, params)`. CSS и разметка плагина живут в обычном DOM на origin страницы.

- Панель manifest с `placement: "sidebar"` добавляется в существующий `SidebarRegistry`, с `placement: "aside"` — в правую полосу `profile.aside`. Виды монтируются общим host-компонентом; скрытие не размонтирует панель, закрытие/disable вызывает disposer, повторное enable создаёт новый экземпляр.
- Вкладка добавляется в `TabRegistry`/`TabViews`; скрытие и перенос между dock-блоками сохраняют stateful view через существующий panel host. Закрытие и disable вызывают cleanup. Восстановленная вкладка отключённого плагина показывает объяснение и закрывается штатной кнопкой; чужой плагин с тем же локальным id её не занимает.
- Для каждой панели и вкладки workspace регистрирует `ide.*` команду с `title`/`description`; команды самого плагина тоже входят в scope workspace и видны агенту.

### Доставка и Hub

Ассеты отдаются только для enabled+trusted пакета, у которого текущий хеш совпадает с путём:

```text
/api/plugins/assets/<package-key>/<content-hash>/<relative-path>
```

`package-key` — base64url имени npm-пакета, поэтому scoped-имя не создаёт двусмысленных сегментов. Маршрут разрешает только каталог объявленного entry, проверяет `enabled`, `trusted`, `status`, hash и каждый сегмент на symlink; traversal, обратные слеши, специальные файлы и корень пакета недоступны. Разрешены JavaScript/ESM, CSS, JSON, изображения, шрифты, wasm и текстовые ассеты с корректным MIME, `X-Content-Type-Options: nosniff` и `Cache-Control: no-store`; HTML не обслуживается. Хеш стоит в пути, а не в query, поэтому относительные `import`/chunks наследуют версию автоматически.

`api.assetUrl(relative)` возвращает URL внутри той же версии и устройства; `relative` считается от каталога артефактов (`dist/`), а не от корня пакета, и не может выйти за него. На Hub страница уже привязана к устройству (`device-url.ts`), и entry грузится через `/api/devices/<id>/plugins/assets/...`; относительные chunks и ассеты идут через тот же туннель без переписывания кода. Каталог и действия плагинов тоже device-aware. Hub не исполняет код плагина в своём Node-процессе и не передаёт абсолютные пути другого устройства.

Доверенный JS на origin Hub технически получает права страницы Hub, включая доступные ей маршруты других устройств. Device-scoped API направляет штатные обращения, но не изолирует враждебный код. Для менее доверенных расширений нужен отдельный origin/iframe и RPC; поверх обычного dynamic import такой режим не обещается.

## Токены темы

JSON токенов — плоский объект. Обязательны `bg`, `bg-2`, `bg-3`, `bg-4`, `bg-sunken`, `canvas`, `line`, `line-strong`, `text`, `text-2`, `muted`, `faint`, `focus`, `accent`, `run`, `err`, `warn`, `info`, `search`, `selection`, `overlay`, `shadow-popover` и `shadow-modal`; `hover` и `active` необязательны. Других ключей быть не должно.

```json
{
  "bg": "#f4ecd8",
  "bg-2": "#eee2c8",
  "bg-3": "#e4d5b5",
  "bg-4": "#d8c7a3",
  "bg-sunken": "#faf4e6",
  "canvas": "#e9ddc2",
  "line": "#c8b690",
  "line-strong": "#a89570",
  "text": "#3b2f25",
  "text-2": "#514236",
  "muted": "#70604f",
  "faint": "#80705e",
  "focus": "#7a4f16",
  "accent": "#8a5a19",
  "run": "#386641",
  "err": "#9b341e",
  "warn": "#835c0b",
  "info": "#285f75",
  "search": "#ead28b",
  "selection": "#d6bd86",
  "overlay": "#00000066",
  "shadow-popover": "0 12px 32px #0000001f",
  "shadow-modal": "0 18px 60px #0000002e"
}
```

Цвета принимаются в hex (`#rgb`, `#rgba`, `#rrggbb`, `#rrggbbaa`), `rgb()`/`rgba()`/`hsl()`/`hsla()` и разрешённых формах `color-mix()`. Тени имеют вид `0 <y>px <blur>px <hex>`. URL, `javascript:`, CSS-блоки и произвольные `var()` не допускаются. Если `hover`/`active` не заданы, используются встроенные производные от `--text`.

Каждый читаемый JSON-файл ограничен 1 МБ. Ошибка манифеста делает весь пакет ошибочным; ошибка отдельной темы добавляет диагностику и исключает темы из доступных, пока у пакета есть диагностика.

## Расположение и состояние

Корень — `$XDG_DATA_HOME/projector/plugins` (обычно `~/.local/share/projector/plugins`; путь возвращается в поле `directory`). Обнаруживаются два вида папок:

- управляемые установки: `plugins/packages/<name>/<version>/`, для scoped-имени — `plugins/packages/@<scope>/<name>/<version>/`;
- прямые папки: `plugins/<folder>/package.json`. Имя папки произвольно, ID всё равно берётся из манифеста. Служебные `plugins/packages` и `plugins/data` не сканируются как прямые пакеты.

Прямые папки можно разместить вручную и затем нажать **Обновить**. По умолчанию обнаруженный пакет выключен. Вложенные папки вне описанных layout не сканируются, папки-симлинки игнорируются.

Включение и выбранная версия хранятся отдельно в `$XDG_DATA_HOME/projector/plugins.json`:

```json
{
  "plugins": {
    "@example/sepia": {
      "enabled": true,
      "version": "1.0.0"
    }
  }
}
```

Файл перезаписывается атомарно с режимом `0600`. Если сохранённой версии нет, она не выбирается автоматически: пакет получает ошибку. Несколько разных версий без выбранной версии или повторяющиеся копии одной `name@version` также дают ошибку.

Статусы пакета:

- `enabled` — пакет включён и прочитан без диагностики; его темы входят в `availableThemes`;
- `disabled` — пакет валиден, но выключен; его темы можно просмотреть, но нельзя применить;
- `error` — ошибка манифеста, версии, дубликата, токенов или агента; вклады недоступны для применения;
- `missing` — запись осталась в `plugins.json`, но пакет не найден на диске.

Пакет с `browser`, `server` или агентами дополнительно имеет `trusted`. Пока доверие не подтверждено, включить его нельзя; после изменения файлов сохранённый хеш перестаёт совпадать, и пакет требует повторного доверия. Ошибка серверного агента переводит пакет в `error`, поэтому его browser runtime и ассеты тоже перестают выдаваться.

При выключении или исчезновении активной внешней темы интерфейс временно возвращается к тёмной схеме; сохранённый внешний ID в `appearance.json` не переписывается. После повторного включения тему нужно применить снова.

## API

Все ответы каталога имеют вид `{ directory, plugins, availableThemes }`. Элемент `plugins` содержит `id`, необязательные `version`, `description`, `path`, `status`, `enabled`, `trusted`, `requiresTrust`, `hash`, `server`, `browser`, `diagnostics: [{ message }]`, `themes`, `agents`, `languages`, `panels` и `tabs`. `browser` — `{ entry, key, hash }`; абсолютных путей к ассетам нет. Элемент `availableThemes` и `themes` содержит полный `id`, `packageName`, `title`, необязательный `description`, `mode` и проверенные `tokens`.

- `GET /api/plugins` — заново обнаруживает и читает локальные пакеты.
- `POST /api/plugins` с `{"action":"refresh"}` — то же обновление каталога.
- `POST /api/plugins` с `{"action":"enable"|"disable","id":"<package>"}` — меняет состояние и возвращает новый каталог. Для `missing` операция отклоняется; для `error` включение отклоняется, выключение разрешено. Пакет с исполняемым кодом нельзя включить без доверия.
- `POST /api/plugins` с `{"action":"trust","id":"<package>"}` — запоминает хеш содержимого пакета с `browser`, `server` или агентами.
- `POST /api/plugins` с `{"action":"remove","id":"<package>"}` — удаляет управляемую установку и её состояние. Пакет, положенный вручную, нужно удалить из его папки.
- `POST /api/plugins` с `{"action":"install","path":"/absolute/or/relative/folder"}` — проверяет и копирует локальную папку в versioned managed-layout. Theme-only пакет включается сразу, пакет с кодом ждёт доверия; ответ — новый каталог.
- `GET|HEAD /api/plugins/assets/<package-key>/<hash>/<relative-path>` — ассет доверенного включённого browser-пакета с текущим хешем. Ответы 404 для disabled/untrusted/stale/HTML/symlink/traversal; `Cache-Control: no-store` и `nosniff`.
- `GET /api/agent/usage/<id>` — лимиты плагинного агента с `usage.command`. Ответ нормализован в `AgentUsage`, ошибки провайдера возвращаются как `unavailable`.

Повторная установка той же версии отклоняется. При копировании допускаются только обычные файлы и папки, симлинки запрещены. Обновления установленной версии нет.

Внешние темы также включены в `themes` ответа `GET /api/appearance` и принимаются `PUT /api/appearance` как `{"choice":"<package>/<theme>"}`, только пока их пакет включён и валиден. `GET /api/appearance/bootstrap.js` устанавливает токены на `<html>` до первого кадра. API доступны только страницам Projector с соответствующей проверкой доступа и Origin; `Cache-Control: no-store` исключает кеширование каталога.

## Установка из папки

1. Создайте папку, например `/tmp/sepia-theme`, со структурой:

   ```text
   sepia-theme/
   ├── package.json
   └── themes/
       └── paper.json
   ```

2. Заполните файлы по примерам выше, заменив имя пакета на своё.
3. Откройте `/settings?section=plugins`, нажмите **Установить из папки** и выберите её либо вставьте путь в поле и нажмите **Установить**.
4. После успешной проверки пакет будет скопирован в `plugins/packages/.../1.0.0`. Пакет с темами включается автоматически — откройте карточку и нажмите **Применить** у темы. Пакет с браузерным кодом, серверным кодом или агентом остаётся выключенным: сначала нажмите **Подтвердить доверие**, затем **Включить**.

Тот же шаг установки через API:

```bash
curl -X POST http://localhost:4177/api/plugins \
  -H 'Content-Type: application/json' \
  --data '{"action":"install","path":"/tmp/sepia-theme"}'
```

Действия также доступны через [IDE-команды](ide-commands.md#локальные-плагины). Контракты и валидация находятся в `packages/core/modules/plugins`, публичный API автора — в `packages/plugin-api`, обнаружение, доверие, установка и ассеты — в `packages/server/modules/plugins`, браузерный runtime и виды вкладов — в `packages/client/modules/plugin-runtime`, настройки и команды — в `packages/client/modules/plugins`.

## Пример и ограничения

Отдельно собираемый пример — [`plugins/example-ui`](../plugins/example-ui): вымышленный язык `.fict`, панель `Fict Inspector` и вкладка `Fict Overview`. Сборка не зависит от исходников хоста:

```bash
vp run build:plugin:example-ui
```

Артефакт `plugins/example-ui/dist/browser.js` — самодостаточный ESM; тест копирует его вне папки примера, импортирует и проверяет, что активируются только объявленные вклады. Доверенный серверный пример Cursor остаётся в [`plugins/cursor`](../plugins/cursor).

Фактические ограничения:

- Нет изолированного runtime или sandbox: браузерный и серверный код доверенный и получает права страницы/процесса. Для чужого кода нужен отдельный origin/iframe и RPC.
- Нет установки и обновления из npm/реестра, подписи пакетов, curated-каталога и автоматического обновления установленной версии.
- Нет shared dependencies для Vue/CodeMirror: UI монтируется в обычный DOM, языки описываются декларативной грамматикой. Произвольные CodeMirror extensions и Vue-компоненты хосту не передаются.
- Плагин не получает отдельного key-value хранилища, настроек, фоновых процессов, Node API и доступа к внутренним модулям.
- Изменение каталога в другом браузере не толкается в реальном времени: страница обновляет каталог действием «Обновить» или следующей загрузкой. Уже исполненный JS не отзывается.
- На Hub device-scoped URL направляют штатные запросы к выбранному устройству, но доверенный код на origin Hub технически видит и другие маршруты, доступные странице Hub.
