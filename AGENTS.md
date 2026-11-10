# Projector

Локальный лаунчер приложений и проектов с GTK-палитрой, веб-интерфейсом, файлами и терминалами для Shell и кодовых агентов. Один сервер на машине: повторный запуск использует работающий процесс.

## Начало работы

Требуются Node.js 24, Vite+ (`vp`), GTK4 и GObject Introspection; для `node-pty` — Python 3, make и C++ compiler. Платформенные зависимости и установка описаны в [README](README.md) и [документации](docs/usage.md).

```bash
vp install
vp run build
./bin/projector           # GTK-палитра по умолчанию
# либо ./bin/projector --browser
```

Веб-интерфейс: <http://localhost:4177>; настройки — `/settings`. Обычный запуск для разработки — `vp dev`; build не создаёт самостоятельный desktop-дистрибутив.

## Критично для разработки

- **Код — в pnpm workspace `packages/`**: `@ai-projector/client`, `server`, `native`, `core` и `cli`. Между пакетами импортируйте по имени (`@ai-projector/core/...`), внутри — относительными путями. Оболочка приложения, тесты и конфиги остаются в корне. Внешние зависимости задаются через `catalog` в `pnpm-workspace.yaml`, в манифестах — только `catalog:`.
- **FEOD обязателен:** импортируйте модули через публичные `index.ts`, сохраняйте границы платформ и отсутствие циклов. См. [архитектуру](docs/architecture.md).
- **Форматируйте только через `vp fmt` (Oxfmt).** Не используйте Prettier, Biome или форматирование Volar. Hooks устанавливает `vp install`; в существующем checkout — `vp hooks enable`. Pre-commit форматирует staged-файлы, сохраняя остальные правки.
- **Проверяйте точечно, полный gate — перед коммитом/PR.** После падения полного gate воспроизведите ошибку точечно, исправьте и повторите gate. Команды — ниже.
- **Не кэшируйте зависящие от среды проверки:** `test:live`, `test:gtk` и браузерные тесты. `vp run --cache check` допустим только для повторного прогона без изменений. Подробности кэширования — в `package.json` и документации Vite+.
- **Каждое действие UI регистрируйте как команду `ide.*`**; кнопки, меню и хоткеи вызывают её. Агент видит только зарегистрированные команды, поэтому заполняйте понятные `title` и `description`. См. [SDK команд](docs/ide-commands.md).
- **Перед проверками сервера смотрите `/api/health` и `/api/status`.** Полный restart и `projector quit` завершают терминалы и дочерние процессы. HMR не должен дублировать процессы и подписки; native обновляется отдельно от сервера.
- **Настройки хранятся на диске** в `$XDG_DATA_HOME/projector` (по умолчанию `~/.local/share/projector`), не в `localStorage`. Файлы с ключами не включайте в Git и отчёты.
- **Релиз в npm — только через OIDC.** `.github/workflows/publish.yml` публикует `@ai-projector/ide` и `@ai-projector/native` из GitHub Release; не добавляйте `NPM_TOKEN`. Первый выпуск каждого имени до настройки trusted publisher делается вручную, детали — в [docs/distribution.md](docs/distribution.md).
- **Системные операции — через `packages/core/modules/os`**; общее поведение поиска — в `packages/core/modules/launcher`. См. [OS](docs/os.md).
- **При изменении UI проверяйте реальное взаимодействие:** фокус окна, drag на границах, контекстное меню, IME и восстановление терминала. В браузерных инструментах указывайте `pageId` и обновляйте snapshot/UID после навигации или HMR.
- **API/PTY/GTK-проверкам нужны сокеты и desktop.** `EPERM` или недоступный display сначала проверяйте как ограничение среды.

## Проверки

```bash
vp test related <изменённый файл>
vp test run tests/<область>.test.mjs -t '<имя теста>' --bail 1
vp check <изменённые файлы>          # fmt + lint + typecheck, без тестов

vp run check                         # полный gate перед коммитом/PR
vp run test:gtk                      # реальные GTK-виджеты; нужен display
```

`vp run check`: architecture → gtk:types → vue-tsc → тесты → build. Для повторных детерминированных шагов можно использовать `vp run --cache architecture|types|build`.

## Документация

Документация в `docs/` описывает текущее устройство и контракты. Основные разделы: [разработка и диагностика](docs/session-notes.md), [архитектура](docs/architecture.md), [CLI](docs/cli.md), [поведение и ограничения](docs/usage.md), [команды IDE](docs/ide-commands.md), [агенты](docs/agent-features.md), [аналитика расхода](docs/analytics.md) и [фоновые задания](docs/agent-jobs.md). Остальные тематические руководства находятся в том же каталоге.

Рабочие материалы держите в [`docs/in-process/`](docs/in-process/README.md) и удаляйте после завершения. История изменений — в `CHANGELOG.md`, задачи — в issue/PR.
