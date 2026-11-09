# Разработка и диагностика

[Начало работы](../README.md) · [Архитектурные границы](architecture.md) · [Поведение и ограничения](usage.md)

## Карта кода

| Место                                                                                                                                                                 | Ответственность                                                                                                                                                                                                             |
| --------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `bin/projector`, `packages/cli/app`                                                                                                                                   | Запуск, команды CLI (`open`, `projects`, `status`, `run`, `stop`), блокировка повторного старта, desktop installation, полный restart                                                                                       |
| `vite.config.ts`, `packages/server/app`                                                                                                                               | Vite, композиция локального HTTP API и SSE                                                                                                                                                                                  |
| `packages/server/modules/launcher`, `packages/server/modules/preferences`                                                                                             | Поиск, история, настройки интерфейса и хоткея                                                                                                                                                                               |
| `packages/server/modules/window`                                                                                                                                      | Вызов native, Chromium, активация и скрытие в X11                                                                                                                                                                           |
| `packages/native/app/entry.ts`, `packages/native/modules/desktop`                                                                                                     | Запуск desktop через OS-адаптер, Vue/GTK-палитра и контроллер                                                                                                                                                               |
| `packages/core/modules/os`, закрытые `modules/linux`, `modules/windows`, `modules/darwin`; `packages/core/modules/os-posix`                                           | Выбор ОС, каталоги, процессы, утилиты; Linux: X11, GIO, D-Bus, трей; Windows: Win32, меню Пуск, трей, хоткей; macOS: `ps`/`lsof`, Keychain, Swift-помощник                                                                  |
| `packages/core/modules/launcher`                                                                                                                                      | Общие контракты, HTTP-клиент и модель поведения DOM/GTK-палитры                                                                                                                                                             |
| `packages/server/modules/processes`, `packages/server/modules/terminal`, `packages/server/modules/terminal-control`                                                   | Процессы проектов, PTY, WebSocket экрана и управления сессиями                                                                                                                                                              |
| `packages/client/modules/terminal`                                                                                                                                    | Список сессий (`useTerminalSessions`), `TerminalView` — один xterm на видимую вкладку, транспорт через SharedWorker (`lib/shared.worker.ts`, `lib/socket.ts`), клавиатура, IME                                              |
| `packages/client/modules/dock`                                                                                                                                        | Раскладка блоков: чистая модель дерева (`model/layout.ts`), разделители, группы вкладок, drag-and-drop                                                                                                                      |
| `packages/server/modules/workspace`, `packages/client/modules/workspace`                                                                                              | Файлы, поиск, Git, архивы и редакторы                                                                                                                                                                                       |
| `packages/server/modules/integration-store`, `secrets`, `github`, `gitlab`, `git-import`                                                                              | Настройки интеграций и секреты (хранилище ОС), GitHub/GitLab API, клонирование                                                                                                                                              |
| `packages/server/modules/environments`, `devcontainer`, `docker`                                                                                                      | Ограниченные Docker-окружения проектов, доверие к Dev Container, панель Docker и Compose                                                                                                                                    |
| `packages/server/modules/agent` (ядро), `packages/server/modules/agents` (бэкенды), `packages/server/modules/providers`, `packages/server/modules/agents-integration` | Реестр и бэкенды агентов, AI-провайдеры и лимиты по интеграциям; клиентский каталог — `packages/client/modules/agents-integration/catalog`, регистрация — `packages/server/app/agents.ts` и `packages/client/app/agents.ts` |
| `packages/server/modules/usage-analytics`, `packages/client/modules/analytics`                                                                                        | Расход токенов по истории чатов и снимки лимитов подписок; контракт и правила темпа — `packages/core/modules/usage-analytics`, маршрут — `/api/analytics` ([аналитика](analytics.md))                                       |
| `packages/server/modules/spend`                                                                                                                                       | Служебные вызовы Projector (Lens, Судья, Доктор, сжатие, ревью, Task) минутными корзинами для распределения по задачам                                                                                                      |
| `packages/server/modules/access`, `packages/server/modules/network`                                                                                                   | LAN-режим, пароль, сессии и ограничения локального доступа; проверка региона для лимитов агентов                                                                                                                            |
| `packages/core/modules/ide`, `packages/client/modules/ide`                                                                                                            | Реестр IDE-команд и привязок клавиш: ядро и браузерный хост                                                                                                                                                                 |

Обычный запуск поднимает `vp dev`; `projector mode prod` переключает на собственный Node-сервер по `dist` (`packages/server/app/standalone.ts`; выбор режима — `packages/core/modules/server-mode`, переключение — `packages/cli/app/launch.ts`). Сборка проверяет типы и собирает фронтенд, но не упаковывает desktop-продукт. Renderer `@zede/vio` устанавливается готовым из npm. Projector имеет собственный Git-корень; перед коммитом проверяйте текущий diff, поскольку другие сессии могут работать в том же checkout.

## Native и vio

GTK работает отдельным Node-процессом. На Linux resident владеет D-Bus именем `dev.projector.Launcher`, интерфейсом `dev.projector.Launcher.Control` на `/dev/projector/Launcher`; GLib MainLoop обслуживает окно, трей и хоткей. На Windows тот же процесс слушает именованный канал `dev.projector.Launcher`, а трей и хоткей держит скрытое окно Win32. На macOS команды идут по Unix-сокету `launcher.sock` в каталоге данных, а меню в строке меню и хоткей обслуживает Swift-помощник. `vp dev` и prod-сервер поднимают этот процесс при старте, без показа палитры. Сервер ждёт `READY` до двадцати секунд.

Native не имеет HMR. После изменений палитры или обновления зависимости `@zede/vio` перезапустите только native:

```bash
node --import @zede/vio/register packages/native/app/entry.ts native http://localhost:4177 quit
./bin/projector --native
```

`projector quit` для этого не подходит: он завершает сервер и его терминалы. При сбое запуска ошибка содержит накопленный stderr native-процесса (последние 8000 символов, `packages/server/modules/window/window.ts`); на timeout ожидания `READY` (20 с) в сообщение попадает накопленный stderr, если процесс успел его напечатать.

Прямой экспорт D-Bus callbacks через node-gtk аварийно завершает процесс; используйте `dbus-next`. GTK-типы генерируются из установленных typelibs командой `vp run gtk:types`, автоматически перед build. `usocket` необязателен, его сборка отключена.

Палитра — `packages/native/modules/desktop/Palette.vue`, общий поиск и выбор — `packages/core/modules/launcher/launcher-model.ts`. Не дублируйте модель для DOM и GTK. В `vio` keyed moves должны сохранять native-объекты, обработчики — заменяться без повторных подключений и отключаться при unmount. Обёртка `setup` сохраняет два аргумента: Vue использует `setup.length` для создания expose/slots context. SFC styles очищаются вместе с Vue scope.

## Окна и хоткей

- Скрывайте палитру по потере активности **всего окна**, а не blur поля. Переход между вводом и результатами не закрывает окно; повторный показ отменяет отложенное скрытие.
- В веб-режиме скрытие действует только для launcher app-surface. Проекты, настройки и обычная вкладка браузера остаются открытыми. `surface=window` сохраняется в `sessionStorage` как состояние окна, а не пользовательская настройка.
- Chromium создаёт helper-окна с тем же классом. Выбор палитры фильтрует окна по `WM_STATE` через `xprop`; класса недостаточно. ID окна и координаты меню получайте заново перед GUI-вводом.
- KDE-хоткей регистрируется через session D-Bus. Собственное назначение допустимо, чужое не перехватывается. При завершении вызывается `setInactive`; настройки показывают фактическую регистрацию.
- Запуск `.desktop` выполняет GIO: сохраняйте поддержку полей `Exec`, `Terminal`, D-Bus activation и скрытых записей.

Проверенное окружение — KDE Plasma/X11. На Wayland активация native требует проверки; повторный показ/скрытие Chromium-палитры через X11-утилиты не поддерживается.

## Процессы, HMR и терминальный ввод

В dev серверный API загружается через один `server.environments.ssr.runner` (Vite Environment API). Конфигурация импортирует лёгкий `packages/server/app/dev-plugin.ts`, а не граф API. Изменения серверных обработчиков обновляют управляемый граф без перезапуска Vite и без нового нативного ESM config bundle. Изменение самого конфига или его зависимостей по-прежнему перезапускает Vite.

Поколение HTTP и операций терминала переключается после успешной загрузки целого entry; открытые control WS обращаются к текущим функциям через стабильные зависимости. Ошибка загрузки оставляет последнее рабочее поколение и показывается в dev overlay. Ошибка уже запущенной операции не приводит к её повтору. Подписки agent/IDE/workspace активируются явно; изменение реализации terminal socket или LAN-защиты освобождает старые транспорты и перепривязывает их. Соединения при этом переподключаются, PTY сохраняются. При добавлении полей глобального состояния всё равно нужна миграция старой схемы.

`globalThis.projectorProcesses` и `globalThis.projectorTerminals` сохраняют состояние при перезагрузке модулей. Не теряйте учёт живых процессов и не создавайте дубли подписок/обработчиков. Полный restart Node завершает терминалы; данные сессий находятся в памяти сервера.

Список терминалов подписывается на `/api/terminal/control?project=<id>`: сервер отправляет полный список при подключении и после создания, удаления, переименования, изменения статуса или размеров сессии. Создание, stop/restart, переименование, проверка активности перед закрытием, закрытие и разрешение файловых ссылок идут запросами с `id` по этому же WS. После обрыва клиент переподключается с задержкой до 10 секунд и получает свежий список; операции с неизвестным результатом автоматически не повторяются. По умолчанию страницы одного origin делят через SharedWorker два WebSocket: управление (`/api/terminal/shared?kind=control`) и данные экрана (`kind=data`); у каждого вида свой логический канал и ACK. Без SharedWorker, при сбое его запуска или с `?terminalTransport=legacy` используются прежние `/api/terminal/control` и `/api/terminal/socket?session=<id>`. HTTP API сохранён для совместимости и загрузки файлов; периодического HTTP-опроса терминалов нет. Подробности и изолированная проверка — [terminal-transport](terminal-transport.md).

Клавиатура имеет несколько слоёв: KDE/XKB и Fcitx5. Одного `LayoutList` недостаточно для диагностики языков. Проверяйте строчные и заглавные символы, композицию и реальные клавиши: вставка Unicode не подтверждает работу IME. Обработчик xterm должен дождаться переведённого текста, сохраняя Ctrl+C, Enter и стрелки.

Текст из `onData` передаётся в UTF-8, legacy mouse reports из `onBinary` — как исходные байты. При восстановлении экрана сохраняйте кодировку мыши SGR/pixel вместе с режимом tracking; сериализации xterm недостаточно. Проверяйте переключение вкладок и переподключение, а не только новую сессию.

## Жесты на телефоне

Общий распознаватель — `packages/client/common/utilities/swipe-gesture.ts`. Он фиксирует одну ось после 8 px, не вызывает `preventDefault` до этого, отдаёт жест длинному нажатию и прокручиваемому предку, который ещё может двигаться в сторону свайпа. `packages/client/modules/workspace/lib/surface-swipe.ts` двигает активную поверхность и передаёт смену штатным переходам, `packages/client/common/utilities/sheet-dismiss.ts` двигает нижнюю шторку и гасит scrim через `--sheet-scrim`. Не добавляйте вторые touch-обработчики: области с собственным панорамированием помечайте `data-swipe-ignore`.

## Данные и проверки

Данные находятся в `$XDG_DATA_HOME/projector`, по умолчанию `~/.local/share/projector`:

| Файл                                                                  | Содержимое                                                                                                                                                                 |
| --------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `launcher.json`                                                       | Режим, хоткей, история запусков                                                                                                                                            |
| `projects.json`                                                       | Каталог проектов                                                                                                                                                           |
| `providers.json`, `integrations.json`                                 | Провайдеры, интеграции и секреты                                                                                                                                           |
| `keybindings.json`                                                    | Привязки команд IDE                                                                                                                                                        |
| `instance.json`, `launch.lock`, `server.log`, `server.log.1…5`        | Запуск, блокировка и диагностика (ротация лога: 10 МиБ на файл, пять архивов)                                                                                              |
| `chrome-profile-launcher`, `chrome-profile`                           | Отдельные профили app-окон                                                                                                                                                 |
| `server-mode`, `network-mode`, `lan-password`                         | Режим сервера (dev/prod), доступ по сети и scrypt-хеш пароля LAN                                                                                                           |
| `appearance.json`, `editor.json`, `files-exclude.json`, `hotkey.json` | Цветовая схема, настройки редактора, исключения дерева, хоткей на Windows и macOS                                                                                          |
| `devcontainer-trust.json`, `browser-proxy-key`, `launcher.token`      | Доверие к Dev Container, ключ прокси браузера, токен резидента                                                                                                             |
| `agent/`, `worktrees/`                                                | История чатов (`history.sqlite`), снимки лимитов и балансов (`analytics.sqlite`), служебные вызовы (`spend.sqlite`), журналы ходов (`runs/`), изолированные копии проектов |

Не меняйте текущий профиль браузера ради тестов. Для изоляции используйте временный XDG-каталог в `/tmp`.

`vp run check` включает архитектуру, типы, тесты и сборку; порядок — architecture → gtk:types → vue-tsc → тесты → build, а шаг architecture кэшируется. Vitest по умолчанию использует два worker-процесса: браузерные тесты дополнительно запускают Vite и Chromium. Быстрые чистые кейсы лежат в `tests/*.cases.mjs` и собираются `tests/units-a.test.mjs`/`tests/units-b.test.mjs`, чтобы не платить форк и импорт за каждый файл; stateful-тесты остаются отдельными `*.test.mjs`. Для точечной проверки используйте `vp test related <изменённый файл>` (он находит нужную сборку по графу импортов) или запустите нужную сборку `tests/units-a.test.mjs`/`tests/units-b.test.mjs`. `--maxWorkers=1` оставляет один worker. `vp test` по умолчанию делает один прогон, `vp test watch` — watch-режим. Тестовые Vite-серверы не запускают FEOD: архитектура — отдельная задача `architecture` в `check`. Браузерные тесты идут конкурентно (5 локально, 2 в CI), фикстура отдаёт `/__tick` за 5 мс. `tests/fixtures/environment-runtime.mjs` по умолчанию делает два поколения, полный прогон — `PROJECTOR_TEST_GENERATIONS=12`; таймаут Kimi в тесте задаёт `PROJECTOR_KIMI_TIMEOUT_MS`. `vp run test:gtk` отдельно проверяет палитру Projector с настоящими GTK-виджетами и внешним `@zede/vio`. Тесты renderer/compiler находятся в [репозитории vio](https://github.com/Sdju/vio). Для затронутой области запускайте соответствующие тесты из `tests/`; они не заменяют проверку реального фокуса, трея, хоткея и событий мыши. Полный `vp run check` — перед коммитом, а не на каждой правке; после падения сначала воспроизводите упавший тест точечно.

Перед GUI-проверкой проверяйте `/api/health` и `/api/status`, затем состояние терминалов на странице проекта. В браузерных инструментах обязательны актуальный `pageId` и свежий snapshot после навигации/HMR. API/PTY-тесты требуют локальных сокетов, GTK — display; `EPERM` сначала отличайте от дефекта приложения.

## Редактор кода и dev-сервер

Редактор — CodeMirror 6 (`packages/client/modules/workspace/modules/viewers/ui/CodeViewer.vue`, `.../viewers/lib/codemirror.ts`). Языки подгружаются лениво из `@codemirror/language-data`, workers и ручной `optimizeDeps` не нужны. Темы — `modules/viewers/lib/codemirror.ts` (`themeExtension`) и список в `packages/core/modules/editor-themes`: чтобы добавить тему, допишите её в список и в `themeExtension`.

`504 Outdated Optimize Dep` означает, что браузер и оптимизатор Vite используют разные состояния предсборки. Проверяйте запросы к `node_modules/.vite/deps` и наличие `_metadata.json`; повторная загрузка страницы сама по себе не восстановит отсутствующие файлы кеша. Изменение Vite-конфигурации обновляет dev-сервер в том же Node-процессе: WebSocket переподключается, а существующие PTY сохраняются. Полный `projector restart` завершит процессы и для этой диагностики не нужен.

Иногда Vite сохраняет **старый transform исходника**: в файле и коммите уже новый код, а `/src/...` и страница отдают предыдущую версию. Это гонка watcher с атомарной перезаписью файла форматтером или Git-хуком: событие приходит раньше финальной записи, а повторного события с новым mtime нет. Признак — старый модуль в ответе на прямой запрос `/src/...` при новом содержимом файла. Быстрый обход — `touch` изменённого файла (или всех файлов последнего коммита):

```bash
git diff-tree --no-commit-id --name-only -r HEAD | grep -E '^(src|core|server)/' | xargs -r touch
```

`.vite-hooks/post-commit` делает это автоматически для исходников из коммита. Если не помогло, перезапустите Vite; `rm -rf node_modules/.vite` относится к ошибкам предсборки зависимостей, а не к этому случаю.

Регрессия `tests/code-editor.test.mjs` запускает изолированный Vite-сервер и headless Chromium: рендер файла и смену языка, diff «в строку» и «две колонки», откат блока в diff, Git-маркеры с peek и откатом, повторное обновление сервера. Тест не подключает API/PTY-плагин Projector и использует отдельный каталог кеша.

## Git в редакторе

Diff `index → рабочий файл` редактируется справа (обычное сохранение), `HEAD → index` только для просмотра; блоки откатываются, вид переключается (`@codemirror/merge`: `unifiedMergeView` / `MergeView`). Git-маркеры: `GET .../workspace/gutter` отдаёт версию из индекса, сравнение идёт на клиенте (`lib/codemirror.ts`, `Chunk`), клик открывает peek с откатом, `Alt+F3` / `Shift+Alt+F3` — следующее/предыдущее изменение.
