# Projector

Локальный лаунчер приложений и проектов с GTK-палитрой, веб-интерфейсом, обзором файлов и терминалами для Shell, Codex, Claude Code, OpenCode, Cursor и Kimi Code. Один сервер на машине: повторный запуск использует работающий процесс.

## Начало работы

Linux, Windows и macOS (на macOS: Xcode Command Line Tools для Swift-помощника меню/хоткея и `brew install gtk4 gobject-introspection pkg-config` для GTK-палитры, его пробует поставить `vp run desktop`; без GTK4 нативный режим недоступен, как на Linux без GTK), Node.js 24, Vite+ (`vp`), GTK4 и GObject Introspection с GioUnix. Для сборки `node-pty` нужны Python 3, make и C++ compiler. Для обзора проектов — `git`, `rg` и GNU `mv`; Python 3 также читает архивы. Проверенное desktop-окружение — KDE Plasma/X11.

```bash
vp install
vp run build
./bin/projector           # GTK-палитра по умолчанию
# либо ./bin/projector --browser
```

Адрес: <http://localhost:4177>. Проекты открываются по пути (`/projects/<путь>`), страницы списка нет; настройки — `/settings`. `vp run desktop` устанавливает пункт меню и команду `projector` (на Windows — ярлык в Пуск без окна консоли и `%LOCALAPPDATA%\bin` в User PATH; на macOS ещё `~/Applications/Projector.app` для Spotlight/Raycast).

## Критично для разработки

- **FEOD обязателен во всех корнях.** Импортируйте модули через публичные `index.ts`, сохраняйте границы платформ и отсутствие циклов. [Архитектура](docs/architecture.md).
- **Единственный форматтер — Oxfmt через `vp fmt`.** Не используйте Prettier, Biome или форматирование Volar; в редакторе выбирайте тот же Oxfmt. `vp install` устанавливает Git hooks через `prepare`; в существующем checkout выполните `vp hooks enable`. Перед коммитом `.vite-hooks/pre-commit` запускает `vp staged --hide-unstaged`: форматирует staged-файлы и обновляет индекс, сохраняя незастейдженные правки. При ошибке коммит блокируется, исходные правки восстанавливаются. Проверка вручную — `vp fmt --check`, состояние hook — `vp hooks status`.
- **Проверяйте точечно; полный gate — перед коммитом.** `vp run check` — это архитектура, типы, все тесты и сборка, а не команда на каждую правку. Во время работы используйте `vp test related <файл>`, точечные `vp test run tests/...` и `vp check <пути>`. Полный `vp run check` запускайте один раз перед коммитом/PR. Если он упал, сначала воспроизведите упавший тест точечно, исправьте и только потом повторите полный gate. Для длинной сессии держите `vp test watch` в отдельном терминале.
- **Кэш задач включайте осознанно.** `package.json` scripts по умолчанию не кэшируются; `vp run --cache <script>` включает кэш, задачи из `run.tasks` кэшируются по умолчанию. В `test`, `build` и `check` шаги architecture/types/build:app уже запускаются с `--cache`. Причины промахов показывает `vp run --last-details`, очищает `vp cache clean`. Кэш инвалидируется аргументами, прочитанными файлами и `cache.env`: правка исходника сбрасывает architecture, правка docs — нет. `vp run --cache check` допустим только для повторного прогона без изменений: тесты в нём тоже могут быть воспроизведены из кэша. Не кэшируйте `test:live`, `test:gtk` и браузерные проверки: они зависят от display, Docker и сети; для задач задавайте `cache: false` или перечисляйте переменные в `cache.env`/`cache.untrackedEnv`.
- **Новая функциональность — это IDE-команды.** Каждое действие, которое можно выполнить из UI, регистрируйте как команду (`ide.*`) в реестре, а кнопки, меню и хоткеи вызывайте через неё. Штатный агент Projector видит и выполняет только зарегистрированные команды, поэтому от их полноты и понятных `title`/`description` зависит качество его работы. Команда без регистрации для агента не существует. [SDK команд](docs/ide-commands.md).
- **Перед проверками выясните состояние сервера:** `/api/health` и `/api/status`. Обычный запуск использует `vp dev`; build пока не создаёт самостоятельный desktop-дистрибутив.
- **Полный restart и `projector quit` завершают терминалы и дочерние процессы.** HMR должен сохранять учёт процессов и подписок без дублей. Native не имеет HMR: обновляйте его отдельно от сервера.
- **Настройки хранятся на диске**, в `$XDG_DATA_HOME/projector` (по умолчанию `~/.local/share/projector`), а не в `localStorage`. Файлы провайдеров и интеграций содержат ключи; не включайте их в Git и отчёты.
- **Системные операции — через `core/modules/os`.** ОС определяется при инициализации; реализации Linux, Windows и macOS (общий POSIX-код в `core/modules/os-posix`) закрыты внутри адаптера. GTK-палитра работает на всех трёх, если установлен GTK4. [API и ограничения](docs/os.md).
- **Общее поведение поиска — в `core/modules/launcher`.** GTK запускается отдельным процессом; `vio` независим от Projector. D-Bus обслуживает `dbus-next`, запуск `.desktop` — GIO.
- **Проверяйте реальное взаимодействие при изменении UI:** фокус всего окна, drag на границах, правый клик, ввод через Fcitx/IME и восстановление терминала. В браузерных инструментах указывайте `pageId` и обновляйте snapshot/UID после навигации или HMR.
- **API/PTY/GTK-проверкам нужны сокеты и доступ к desktop.** `EPERM` или недоступный display сначала проверяйте как ограничение среды запуска.

`vp run check` проверяет типы до тестов и убирает повторный явный запуск architecture. Порядок: architecture (кэшируется) → gtk:types → vue-tsc → тесты → build; `vp build` дополнительно прогоняет FEOD на `buildStart`.

```bash
# Во время правки: только затронутое
vp test related <изменённый файл>
vp test run tests/<область>.test.mjs -t '<имя теста>' --bail 1
vp check <изменённые файлы>          # fmt + lint + typecheck, без тестов

# Повторный детерминированный шаг: architecture/types/build кэшируются
vp run --cache architecture
vp run --cache types
vp run --cache build

# Полный gate перед коммитом/PR — один раз
vp run check
vp run test:gtk                      # реальные GTK-виджеты; нужен display
```

## Документация

- [Разработка и диагностика](docs/session-notes.md): карта кода, HMR, native, ввод и данные.
- [Рабочие материалы](docs/in-process/README.md): дорожные карты, открытые вопросы и варианты решений; удаляются после завершения.
- [Производительность](docs/performance.md): пределы памяти и скорости, методология замера.
- [Реестр больших файлов](docs/large-files.md): потолки размеров и планы разбиения; проверка (`extra.largeFiles` в `feod.config.mjs`) включена в `vp run architecture`.
- [Использование](docs/usage.md): режимы, хоткей, трей, файлы и терминалы.
- [Интеграции](docs/integrations.md): GitHub, авторизация и импорт.
- [Архитектура](docs/architecture.md), [адаптер ОС](docs/os.md), [транспорт терминалов](docs/terminal-transport.md), [Docker](docs/docker.md) и [решения по контейнерам](docs/containers-design.md).
- [UI-кит](docs/ui-kit.md), [виртуализация списков](docs/virtualization.md).
- [Компоненты в ответах агента](docs/agent-widgets.md): каталог виджетов, прогрессивный рендер, формы и `reply`.
- [Возможности агентов](docs/agent-features.md): остров в табе агента, умолчания в настройках, выдача виджетов Claude Code, Codex, OpenCode, Cursor и Kimi.
- [Делегирование](docs/agent-delegation.md): фоновые задания кодовых агентов, разрешения в чате Projector, автопродолжение, копии и границы.
- [Независимость от агентов](docs/architecture.md#агенты-чата-и-их-особенности): реестр и клиентский каталог вместо перечислений в терминале, настройках, OS-адаптере и клиенте; паритет реестров проверяет `tests/agent-catalog.test.mjs`.
- [Форки чатов](docs/chat-forks.md): ветка от сообщения в новую вкладку, индекс недавних чатов и возврат закрытых вкладок.
- [Вопросы в сторону](docs/agent-side.md): `/btw` без прерывания агента, read-only состояние чата и отсутствие записи в историю.
- [Lens](docs/agent-lens.md): живая подпись о текущей работе в блоке «Работа», обновление по таймеру и свой Lens у сабагента.
- [SDK команд IDE](docs/ide-commands.md), [темы иконок](docs/file-icons.md), [renderer vio](https://github.com/Sdju/vio/blob/main/packages/vio/README.md).

Документация в `docs/` описывает текущее устройство, контракты и ограничения. Рабочие материалы — дорожные карты, открытые вопросы, варианты решений и статусы — держите в [`docs/in-process/`](docs/in-process/README.md) и удаляйте после завершения. История изменений — в `CHANGELOG.md`, задачи — в issue/PR.
