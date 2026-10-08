# Разработка и диагностика

[Начало работы](../README.md) · [Архитектурные границы](architecture.md) · [Использование](usage.md)

## Карта кода

| Место                                                                                    | Ответственность                                                                                                |
| ---------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------- |
| `bin/projector`, `cli/app`                                                               | Запуск, блокировка повторного старта, desktop installation, полный restart                                     |
| `vite.config.ts`, `server/app`                                                           | Vite, композиция локального HTTP API и SSE                                                                     |
| `server/modules/launcher`, `server/modules/preferences`                                  | Поиск, история, настройки интерфейса и хоткея                                                                  |
| `server/modules/window`                                                                  | Вызов native, Chromium, активация и скрытие в X11                                                              |
| `native/app/entry.ts`, `native/modules/desktop`                                          | Запуск desktop через OS-адаптер, Vue/GTK-палитра и контроллер                                                  |
| `core/modules/os`, закрытые `modules/linux` и `modules/windows`                          | Выбор ОС, каталоги, процессы, утилиты; Linux: X11, GIO, D-Bus, трей; Windows: Win32, меню Пуск                 |
| `core/modules/launcher`                                                                  | Общие контракты, HTTP-клиент и модель поведения DOM/GTK-палитры                                                |
| `packages/vio`                                                                           | Независимый Vue renderer для GTK4, SFC loader, стили и demo                                                    |
| `server/modules/processes`, `server/modules/terminal`, `server/modules/terminal-control` | Процессы проектов, PTY, WebSocket экрана и управления сессиями                                                 |
| `src/modules/terminal`                                                                   | Список сессий (`useTerminalSessions`), `TerminalView` — один xterm и сокет на видимую вкладку, клавиатура, IME |
| `src/modules/dock`                                                                       | Раскладка блоков: чистая модель дерева (`model/layout.ts`), разделители, группы вкладок, drag-and-drop         |
| `server/modules/workspace`, `src/modules/workspace`                                      | Файлы, поиск, Git, архивы и редакторы                                                                          |
| `server/modules/integration-store`, `secrets`, `github`, `gitlab`, `git-import`          | Настройки интеграций и секреты (хранилище ОС), GitHub/GitLab API, клонирование                                 |
| `server/modules/environments`, `devcontainer`, `docker`                                  | Ограниченные Docker-окружения проектов, доверие к Dev Container, панель Docker и Compose                       |
| `server/modules/agent`, `server/modules/providers`, `server/modules/agents-integration`  | Агент Projector, AI-провайдеры, лимиты Codex/Claude/OpenCode/Cursor                                            |
| `server/modules/access`, `server/modules/network`                                        | LAN-режим, пароль, сессии и ограничения локального доступа; проверка региона для лимитов агентов               |
| `core/modules/ide`, `src/modules/ide`                                                    | Реестр IDE-команд и привязок клавиш: ядро и браузерный хост                                                    |

Обычный запуск поднимает `vp dev`; `projector mode prod` переключает на собственный Node-сервер по `dist` (`server/app/standalone.ts`; выбор режима — `core/modules/server-mode`, переключение — `cli/app/launch.mjs`). Сборка проверяет типы и собирает фронтенд и `vio`, но не упаковывает desktop-продукт. Projector имеет собственный Git-корень; перед коммитом проверяйте текущий diff, поскольку другие сессии могут работать в том же checkout.

## Native и vio

GTK работает отдельным Node-процессом. На Linux resident владеет D-Bus именем `dev.projector.Launcher`, интерфейсом `dev.projector.Launcher.Control` на `/dev/projector/Launcher`; GLib MainLoop обслуживает окно, трей и хоткей. На Windows тот же цикл GTK слушает именованный канал `dev.projector.Launcher`; трея и хоткея нет. Сервер ждёт `READY` до восьми секунд.

Native не имеет HMR. После изменений пересоберите `vio`, если менялся renderer, и перезапустите только native:

```bash
vp run vio:build
node --import vio/register native/app/entry.ts native http://localhost:4177 quit
./bin/projector --native
```

`projector quit` для этого не подходит: он завершает сервер и его терминалы. При сбое запуска ошибка содержит накопленный stderr native-процесса (последние 8000 символов, `server/modules/window/window.ts`); на timeout ожидания `READY` (8 с) stderr в сообщение не попадает — запустите native вручную и выясните этап сбоя.

Прямой экспорт D-Bus callbacks через node-gtk аварийно завершает процесс; используйте `dbus-next`. GTK-типы генерируются из установленных typelibs командой `vp run gtk:types`, автоматически перед build. `usocket` необязателен, его сборка отключена.

Палитра — `native/modules/desktop/Palette.vue`, общий поиск и выбор — `core/modules/launcher/launcher-model.ts`. Не дублируйте модель для DOM и GTK. В `vio` keyed moves должны сохранять native-объекты, обработчики — заменяться без повторных подключений и отключаться при unmount. Обёртка `setup` сохраняет два аргумента: Vue использует `setup.length` для создания expose/slots context. SFC styles очищаются вместе с Vue scope.

## Окна и хоткей

- Скрывайте палитру по потере активности **всего окна**, а не blur поля. Переход между вводом и результатами не закрывает окно; повторный показ отменяет отложенное скрытие.
- В веб-режиме скрытие действует только для launcher app-surface. Проекты, настройки и обычная вкладка браузера остаются открытыми. `surface=window` сохраняется в `sessionStorage` как состояние окна, а не пользовательская настройка.
- Chromium создаёт helper-окна с тем же классом. Выбор палитры фильтрует окна по `WM_STATE` через `xprop`; класса недостаточно. ID окна и координаты меню получайте заново перед GUI-вводом.
- KDE-хоткей регистрируется через session D-Bus. Собственное назначение допустимо, чужое не перехватывается. При завершении вызывается `setInactive`; настройки показывают фактическую регистрацию.
- Запуск `.desktop` выполняет GIO: сохраняйте поддержку полей `Exec`, `Terminal`, D-Bus activation и скрытых записей.

Проверенное окружение — KDE Plasma/X11. На Wayland активация native требует проверки; повторный показ/скрытие Chromium-палитры через X11-утилиты не поддерживается.

## Процессы, HMR и терминальный ввод

`globalThis.projectorProcesses` и `globalThis.projectorTerminals` сохраняют состояние при перезагрузке модулей. Не теряйте учёт живых процессов и не создавайте дубли подписок/обработчиков. Полный restart Node завершает терминалы; данные сессий находятся в памяти сервера.

Список терминалов подписывается на `/api/terminal/control?project=<id>`: сервер отправляет полный список при подключении и после создания, удаления, переименования, изменения статуса или размеров сессии. Создание, stop/restart, переименование, проверка активности перед закрытием, закрытие и разрешение файловых ссылок идут запросами с `id` по этому же WS. После обрыва клиент переподключается с задержкой до 10 секунд и получает свежий список; операции с неизвестным результатом автоматически не повторяются. Экран, ввод и resize остаются на `/api/terminal/socket?session=<id>`. HTTP API сохранён для совместимости и загрузки файлов; периодического HTTP-опроса терминалов нет.

Клавиатура имеет несколько слоёв: KDE/XKB и Fcitx5. Одного `LayoutList` недостаточно для диагностики языков. Проверяйте строчные и заглавные символы, композицию и реальные клавиши: вставка Unicode не подтверждает работу IME. Обработчик xterm должен дождаться переведённого текста, сохраняя Ctrl+C, Enter и стрелки.

Текст из `onData` передаётся в UTF-8, legacy mouse reports из `onBinary` — как исходные байты. При восстановлении экрана сохраняйте кодировку мыши SGR/pixel вместе с режимом tracking; сериализации xterm недостаточно. Проверяйте переключение вкладок и переподключение, а не только новую сессию.

## Данные и проверки

Данные находятся в `$XDG_DATA_HOME/projector`, по умолчанию `~/.local/share/projector`:

| Файл                                         | Содержимое                       |
| -------------------------------------------- | -------------------------------- |
| `launcher.json`                              | Режим, хоткей, история запусков  |
| `projects.json`                              | Каталог проектов                 |
| `providers.json`, `integrations.json`        | Провайдеры, интеграции и секреты |
| `keybindings.json`                           | Привязки команд IDE              |
| `instance.json`, `launch.lock`, `server.log` | Запуск, блокировка и диагностика |
| `chrome-profile-launcher`, `chrome-profile`  | Отдельные профили app-окон       |

Не меняйте текущий профиль браузера ради тестов. Для изоляции используйте временный XDG-каталог в `/tmp`.

`vp run check` включает архитектуру, тесты, типы и сборку. `vp run vio:gtk-test` отдельно проверяет настоящие GTK-виджеты. Для затронутой области запускайте соответствующие тесты из `tests/`; они не заменяют проверку реального фокуса, трея, хоткея и событий мыши.

Перед GUI-проверкой проверяйте `/api/health` и `/api/status`, затем состояние терминалов на странице проекта. В браузерных инструментах обязательны актуальный `pageId` и свежий snapshot после навигации/HMR. API/PTY-тесты требуют локальных сокетов, GTK — display; `EPERM` сначала отличайте от дефекта приложения.

## Редактор кода и dev-сервер

Редактор — CodeMirror 6 (`src/modules/workspace/modules/viewers/ui/CodeViewer.vue`, `.../viewers/lib/codemirror.ts`). Языки подгружаются лениво из `@codemirror/language-data`, workers и ручной `optimizeDeps` не нужны. Темы — `modules/viewers/lib/codemirror.ts` (`themeExtension`) и список в `core/modules/editor-themes`: чтобы добавить тему, допишите её в список и в `themeExtension`.

`504 Outdated Optimize Dep` означает, что браузер и оптимизатор Vite используют разные состояния предсборки. Проверяйте запросы к `node_modules/.vite/deps` и наличие `_metadata.json`; повторная загрузка страницы сама по себе не восстановит отсутствующие файлы кеша. Изменение Vite-конфигурации обновляет dev-сервер в том же Node-процессе: WebSocket переподключается, а существующие PTY сохраняются. Полный `projector restart` завершит процессы и для этой диагностики не нужен.

Регрессия `tests/code-editor.test.mjs` запускает изолированный Vite-сервер и headless Chromium: рендер файла и смену языка, diff «в строку» и «две колонки», откат блока в diff, Git-маркеры с peek и откатом, повторное обновление сервера. Тест не подключает API/PTY-плагин Projector и использует отдельный каталог кеша.

## Git в редакторе

Diff `index → рабочий файл` редактируется справа (обычное сохранение), `HEAD → index` только для просмотра; блоки откатываются, вид переключается (`@codemirror/merge`: `unifiedMergeView` / `MergeView`). Git-маркеры: `GET .../workspace/gutter` отдаёт версию из индекса, сравнение идёт на клиенте (`lib/codemirror.ts`, `Chunk`), клик открывает peek с откатом, `Alt+F3` / `Shift+Alt+F3` — следующее/предыдущее изменение.
