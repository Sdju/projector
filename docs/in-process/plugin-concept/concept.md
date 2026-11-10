# Концепт плагинов Projector

Рабочий концепт. Первый практический результат — установка и применение цветовых схем без изменения компонентов и без исполнения кода плагина.

## Решение

Плагин — версионируемый локальный пакет с манифестом и декларативными вкладами. У него есть стабильный ID, версия API Projector, состояние включения и собственные данные. В первой версии единственный вклад — `themes`: набор разрешённых цветовых токенов.

У [Orca Note](https://www.orca-studio.com/orcanote-docs/documents/Quick_Start.html) берём:

- папку плагина с манифестом и ресурсами;
- namespaced ID вкладов;
- включение/выключение с регистрацией и очисткой вкладов;
- регистрацию тем, команд, настроек и хранилища как отдельных API.

Не копируем обязательный `dist/index.js`, произвольный CSS, глобальный объект с прямым доступом к состоянию, идентичность по имени папки и ручной `unregister` как единственный механизм очистки.

Главный компромисс: декларативный формат менее гибок, чем JS/CSS у Orca, но позволяет выпустить полезные плагины без sandbox, разрешений и риска сломать интерфейс произвольными стилями.

## Формат theme-only пакета

```text
gruvbox-material/
  package.json
  icon.svg                  # необязательно
  themes/
    material-dark.json
    material-light.json
```

```json
{
  "name": "@sainnhe/projector-gruvbox-material",
  "version": "1.4.2",
  "description": "Gruvbox Material для Projector",
  "engines": { "projector": ">=0.9" },
  "projector": {
    "apiVersion": 1,
    "contributes": {
      "themes": [
        {
          "id": "material-dark",
          "title": "Material Dark",
          "mode": "dark",
          "tokens": "themes/material-dark.json"
        },
        {
          "id": "material-light",
          "title": "Material Light",
          "mode": "light",
          "tokens": "themes/material-light.json"
        }
      ]
    }
  }
}
```

Полный ID темы: `<package-name>/<theme-id>`. JSON темы содержит только allowlist существующих 25 цветовых и теневых токенов; `mode` задаёт `color-scheme`. Запрещены CSS-селекторы, `url()`, внешние ресурсы, исполняемые entrypoint и lifecycle scripts.

Схема интерфейса и согласованная тема редактора в UX образуют пару. Технически вклад редактора можно добавить отдельным полем после стабилизации `--syntax-*`; не смешивать его с текущим закрытым списком `editorThemes` до появления общего открытого реестра.

## Хранение и жизненный цикл

```text
$XDG_DATA_HOME/projector/
  plugins/
    packages/<plugin-id>/<version>/...
    data/<plugin-id>/...
  plugins.json
  appearance.json
```

`plugins.json` хранит enabled-состояние, выбранную версию, хеши и диагностику. `appearance.json` остаётся источником выбранной схемы. Состояния плагина: `disabled`, `enabled`, `error`, `missing`; ошибка одного пакета не блокирует остальные.

При включении сервер валидирует пакет и публикует его темы в каталоге. При выключении темы исчезают из доступных без перезапуска. Если активная тема отключена или удалена, интерфейс временно использует `dark`; сохранённый ID не затирается, чтобы тема восстановилась после возврата пакета.

Для runtime-плагинов следующего этапа: `activate(context)` возвращает disposer, а `context.signal` и plugin-scope гарантируют очистку команд, подписок и вкладов. Доверенный browser runtime не считается sandboxed; обновление хеша требует повторного доверия.

## Архитектура

Новые модули:

- `packages/core/modules/plugins` — browser-safe типы манифеста, вкладов, `apiVersion`, validation limits;
- `packages/server/modules/plugins` — discovery, безопасное чтение, каталог, установка, enabled state и диагностика;
- `packages/client/modules/plugins` — экраны каталога и управления; runtime host появится позже;
- `packages/server/routes/api/plugins.ts` — API каталога и действий.

Существующий `appearance` остаётся владельцем применения темы. Его закрытый `ColorScheme` нужно разделить на открытый `ThemeId` и `ColorMode`; статический `appearanceOptions` заменяется объединением встроенных и включённых внешних тем. `/api/appearance/bootstrap.js` должен вставлять токены активной внешней темы до первого кадра, иначе будет вспышка встроенной схемы. Hub продолжает получать bootstrap с конкретного устройства.

Установка MVP — выбор локальной папки, копирование в managed directory, проверка и атомарное переключение. Npm/tarball — следующий шаг: staging, `--ignore-scripts`, проверка совместимости и rollback. Не сканировать глобальный `node_modules` и не связывать версии плагинов с lockstep-моделью `@ai-projector/native`.

Каждое действие UI регистрируется командой: `ide.plugins.list`, `ide.plugins.refresh`, `ide.plugins.folder.open`, `ide.plugin.open`, `ide.plugin.enable`, `ide.plugin.disable`, `ide.plugin.theme.apply`. Маршрут раздела — `/settings?section=plugins`, карточка добавляет `plugin=<id>`.

## UX и визуальный концепт

Раздел находится в настройках рядом с интерфейсом и редактором. Это библиотека локальных пакетов, не магазин: без аккаунтов, рейтингов, покупок и автоматических обновлений.

1. **Каталог** — поиск, фильтры тёмных/светлых схем, превью палитр, автор/версия, статус установки и действие «Установить из папки». Каталог на экране — целевой curated UI; до появления источника метаданных MVP показывает только локальные пакеты.
2. **Карточка пакета** — светлое и тёмное превью, переключатель редактора/терминала/интерфейса, совместимость, лицензия и явная маркировка «Только данные, без кода». Выбор схемы применяется сразу и сохраняется.
3. **Установленные** — включение/выключение, текущая тема, локальная установка, состояния ошибки/отсутствия и объяснение ограничений.

Статические мокапы: [каталог](01-catalog.png), [Gruvbox Material](02-gruvbox.png), [установленные](03-installed.png). Автономный HTML — [index.html](index.html), экраны переключаются через `#catalog`, `#gruvbox`, `#installed`.

## Этапы

1. **Theme-only MVP:** манифест, JSON-токены, локальная папка, discovery, enable/disable, применение и bootstrap без вспышки, встроенный fallback.
2. **Поставка:** npm/tarball install/update/remove, curated metadata catalog, диагностика несовместимости и rollback.
3. **Browser runtime:** узкий versioned `PluginContext`, команды, уведомления, settings schema и изолированное key-value хранилище; доверие по хешу.
4. **UI и Node capabilities:** отдельно проектировать вкладки/renderers и серверные разрешения; не расширять runtime неявно.

## Проверка MVP

- манифест и токены: неизвестные поля, размеры, конфликты ID, режим и совместимость;
- discovery: битый пакет, symlink/path traversal, duplicate ID, изоляция ошибки;
- API: same-origin/access control, enable/disable/uninstall активной темы, атомарность;
- browser/Hub: внешние токены в bootstrap, `color-scheme` и `theme-color`, переключение без reload, fallback;
- реальные экраны: чат, файлы, Git/diff, редактор/Markdown, терминал, настройки, мобильная ширина;
- установка production-пакета в отдельный data dir без npm scripts.

Вне MVP: произвольный JS/CSS/Vue, Node API, сетевые и файловые разрешения, зависимости между плагинами, аккаунты, отзывы, покупки, визуальный редактор тем и автообновления.
