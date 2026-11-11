# Локальные плагины

Projector поддерживает локальные декларативные плагины: цветовые схемы интерфейса и ACP-агентов. Пакет состоит из `package.json` и JSON-файлов; JavaScript из пакета не загружается и не выполняется. Управление находится в **Настройки → Плагины**: там можно установить папку, включить или выключить пакет, подтвердить доверие к агенту, посмотреть диагностику, применить тему и удалить управляемую установку.

Агентский плагин запускает внешнюю команду на машине пользователя, поэтому включается только после явного доверия к хешу содержимого пакета. Команд, компонентов, вкладок, настроек, серверных обработчиков и других вкладов плагин добавить не может; общего plugin runtime и установки из npm или реестра нет.

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
- `projector.apiVersion` обязателен и сейчас равен только `1`; контракт ещё в проработке.
- `projector.contributes` содержит хотя бы один непустой вклад: `themes` или `agents`.
- `projector.contributes.themes` необязателен; если он есть, каждая тема проверяется по правилам ниже.
- `projector.contributes.agents` необязателен; агент описывается декларативно и запускается через ACP.
- У темы обязательны уникальный внутри пакета `id` (`a-z`, `0-9`, `.`, `_`, `-`, начинается с буквы или цифры), `title`, `mode` (`dark` или `light`) и `tokens`. `description` необязателен.
- `tokens` — относительный путь к `.json` внутри пакета. Абсолютные пути, `.`/`..` в сегментах и симлинки запрещены; файл должен быть обычным файлом.

Полный ID внешней темы — `<package>/<theme>`, например `@example/sepia/paper`. Он сохраняется как выбор оформления в `appearance.json`.

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

Агентский пакет после установки остаётся выключенным. Сначала пользователь подтверждает доверие к текущему содержимому пакета; в `plugins.json` сохраняется хеш. Если файлы изменились, включать агента нужно после повторного подтверждения. Коллизия id или `program` со встроенным агентом не заменяет его, а показывает диагностику.

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

Токенную аналитику плагин тоже приносит с собой: `backend.usageLog` принимает `UsageLogReader` (`agent`, `label`, `roots()`, `files()`, `read()` и необязательные `append`/`maxBytes`). Projector регистрирует читатель вместе с агентом, сканирует его журналы в общую вкладку «Аналитика расхода» и снимает читатель при выключении плагина. Читатель возвращает метаданные — время, модель, каталог, токены и необязательную стоимость; промпты и вывод инструментов не индексируются. Встроенные Codex, OpenCode и Kimi используют ровно этот путь.

Код выполняется **в процессе сервера с его правами**, без песочницы. Поэтому он загружается только после явного доверия и включения пакета, а изменение любого файла пакета снимает доверие. Это не заменяет будущий изолированный runtime: произвольный UI, команды и доступ к внутренним модулям через этот API не выдаются.

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

Агентский пакет дополнительно имеет `trusted`. Пока доверие не подтверждено, включить его нельзя; после изменения файлов сохранённый хеш перестаёт совпадать, и пакет требует повторного доверия.

При выключении или исчезновении активной внешней темы интерфейс временно возвращается к тёмной схеме; сохранённый внешний ID в `appearance.json` не переписывается. После повторного включения тему нужно применить снова.

## API

Все ответы каталога имеют вид `{ directory, plugins, availableThemes }`. Элемент `plugins` содержит `id`, необязательные `version`, `description`, `path`, `status`, `enabled`, `trusted`, `hash`, `server`, `diagnostics: [{ message }]`, `themes`, `agents` и `code`. Элемент `availableThemes` и `themes` содержит полный `id`, `packageName`, `title`, необязательный `description`, `mode` и проверенные `tokens`.

- `GET /api/plugins` — заново обнаруживает и читает локальные пакеты.
- `POST /api/plugins` с `{"action":"refresh"}` — то же обновление каталога.
- `POST /api/plugins` с `{"action":"enable"|"disable","id":"<package>"}` — меняет состояние и возвращает новый каталог. Для `missing` операция отклоняется; для `error` включение отклоняется, выключение разрешено. Агентский пакет нельзя включить без доверия.
- `POST /api/plugins` с `{"action":"trust","id":"<package>"}` — запоминает хеш содержимого агентского пакета.
- `POST /api/plugins` с `{"action":"remove","id":"<package>"}` — удаляет управляемую установку и её состояние. Пакет, положенный вручную, нужно удалить из его папки.
- `POST /api/plugins` с `{"action":"install","path":"/absolute/or/relative/folder"}` — проверяет и копирует локальную папку в versioned managed-layout. Theme-only пакет включается сразу, агентский ждёт доверия; ответ — новый каталог.
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
4. После успешной проверки пакет будет скопирован в `plugins/packages/.../1.0.0`. Пакет с темами включается автоматически — откройте карточку и нажмите **Применить** у темы. Пакет с агентом остаётся выключенным: сначала нажмите **Подтвердить доверие**, затем **Включить**.

Тот же шаг установки через API:

```bash
curl -X POST http://localhost:4177/api/plugins \
  -H 'Content-Type: application/json' \
  --data '{"action":"install","path":"/tmp/sepia-theme"}'
```

Действия также доступны через [IDE-команды](ide-commands.md#локальные-плагины). Контракты и валидация находятся в `packages/core/modules/plugins`, обнаружение, доверие и установка — в `packages/server/modules/plugins`, UI и команды — в `packages/client/modules/plugins`.
