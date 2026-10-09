# Адаптер ОС

`core/modules/os/index.ts` — единственный публичный вход для системных операций CLI, сервера и native. Браузер и доменные модули `core` не могут его импортировать.

```ts
import { os } from "../../../core/modules/os/index.ts";

os.platform; // process.platform, определяется при загрузке
os.supported; // true для Linux, Windows и macOS
os.capabilities.nativeDesktop; // резидент (трей, хоткей): Linux, Windows, macOS
os.capabilities.gtkPalette; // GTK-палитра: Linux и Windows
os.capabilities.giLoader; // предзагрузка GIO в helper: только Linux
os.capabilities.processInspection;
const processes = os.processes.list();
const cwd = await os.processes.workingDirectory(pid, projectPath);
await os.tools.moveNoReplace(source, destination);
```

## Структура

```text
core/modules/os/
  index.ts                  публичный API и типы
  os.ts                     выбор адаптера, capabilities и единый фасад
  contract.ts               процесс и интерфейс контроллера палитры
  modules/linux/            /proc, X11, GIO, D-Bus, Secret Service, трей
  modules/darwin/           macOS: ps/lsof, Keychain (security), open, osascript; без GTK-палитры
  ../os-posix/              общий POSIX-код Linux и macOS: агенты, Git askpass, Docker/bash, токены CLI
  modules/windows/          Win32-процессы, Credential Manager, меню Пуск, окно Chromium, GTK-палитра, трей, хоткей
```

Подмодули `linux` и `windows` приватны для фасада. Новая ОС регистрируется в `createOs`; потребители сохраняют вызовы `os.*`. Фабрика экспортирована для проверки выбора платформы. Singleton `os` выбирает систему один раз, а пользовательские настройки окружения (XDG, LOCALAPPDATA, SHELL) читаются при обращении.

## Ответственность API

| API                                                  | Что адаптирует                                                                                                                                                          |
| ---------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `dataHome`, `desktopPaths`, `homeDirectory`, `shell` | Пользовательские каталоги и командную оболочку                                                                                                                          |
| `processes`                                          | Список процессов, потомков, identity для защиты от повторного использования PID, cwd, сигнал и ожидание завершения                                                      |
| `tools`                                              | Перенос без перезаписи, изолированный Python helper и поиск ripgrep                                                                                                     |
| `windows`                                            | Открытие браузера/app-окна, поиск, активацию, скрытие и закрытие палитры                                                                                                |
| `catalog`                                            | Ленивую загрузку GIO-каталога и иконок внутри native-процесса с GI loader                                                                                               |
| `secrets`                                            | Системное хранилище секретов: `available`, `get`, `set`, `delete` (ключ — `service` и `account`); `available` не бросает ошибок, разблокировка может показать диалог ОС |
| `shortcutStatus`, `shortcutAvailable`, `desktopPid`  | Desktop-интеграцию без загрузки GTK                                                                                                                                     |
| `runDesktop`                                         | Resident; приложение передаёт каталог настроек и фабрику контроллера палитры                                                                                            |
| `installDesktop`                                     | Установку из текущего checkout, с учётом XDG и пробелов в пути                                                                                                          |

`moveNoReplace` не перезаписывает существующую запись. GNU mv при совпадении может успешно завершиться, оставив источник на месте: вызывающий код проверяет результат переноса и сообщает о конфликте. Проверки допустимости путей и ошибки HTTP остаются в workspace, а не в OS-адаптере.

## Загрузка и ограничения

Импорт `os` не загружает GTK, GIO или D-Bus и не создаёт соединения. Native-компоненты загружаются по буквальным file URL: это сохраняет ленивость при сборке Vite-конфигурации; архитектурный checker проверяет такие зависимости.

Для неподдерживаемых ОС (всё, кроме Linux, Windows и macOS) `supported` и capabilities равны false. Список процессов возвращает `null`, сведения о хоткее показывают отсутствие поддержки. Операции с отсутствующей реализацией выбрасывают `UnsupportedPlatformError` с кодом `ERR_OS_UNSUPPORTED`, а не запускают команды другой ОС.

Capabilities означают наличие реализации, а не установленность утилит. Linux для трея и глобального хоткея требует KDE (StatusNotifier и KGlobalAccel). На Windows `nativeDesktop` тоже true: палитра запускается через GTK4 из `node-gtk` отдельным процессом, команды между запусками идут по именованному каналу, фокус окна — по HWND. Трей — иконка области уведомлений, хоткей — `RegisterHotKey`; оба живут в резиденте палитры. Каталог меню Пуск читается без GTK (`giLoader === false`). Работают каталоги (`LOCALAPPDATA`, с приоритетом `XDG_DATA_HOME`), процессы, перенос файлов, Git Bash или PowerShell, Credential Manager, меню Пуск и окно Chromium. Запуск на Windows — `bin/projector.cmd`.

Порт сервера и модель хранения проектов — настройки приложения; они не относятся к OS-адаптеру. Импорт ключей ai-companion принимает путь аргументом:

```bash
node cli/app/import-companion-key.mjs /path/to/providers.json
```

## macOS: как устроено и что не поддерживается

- **Палитра:** при установленном GTK4 (`brew install gtk4 gobject-introspection`; `gtkPalette` true) резидент открывает ту же GTK-палитру, что на Linux и Windows: GTK обслуживается таймером из Node, а после показа процесс выводится на передний план помощником. Без GTK4 палитра — окно Chromium (`--app`, помечено `--class=<имя>`); оно находится по `ps`, а `NSRunningApplication` в помощнике даёт фокус, скрытие, возврат и закрытие (toggle работает). Резидент печатает `PALETTE:gtk|web`.
- **Трей и хоткей:** значок в строке меню и глобальный хоткей (`Ctrl+Alt+Space`, `Alt+Space`) обслуживает Swift-помощник `helper.swift`: он собирается `swiftc` при первом запуске в `<данные>/projector/native` (нужны Xcode Command Line Tools). С `PROJECTOR_SHELL_TEST=1` он принимает `menu N` и `press-hotkey`, чтобы тест прогонял настоящие обработчики без прав на ввод.
- **Один экземпляр:** unix-сокет `launcher.sock` в каталоге данных (0600) + токен `launcher.token`; повторный запуск пересылает команду.
- **Каталог** — `.app` из `/Applications`, `/System/Applications`, `~/Applications`; запуск `open -a`, иконка — `.icns` → PNG через `sips`.
- **Процессы** — `ps -axo` (в том числе `tpgid` для foreground-группы), cwd — `lsof -d cwd`. Общий POSIX-код (агенты, process groups, Git askpass, Docker, bash, права `0600`) живёт в модуле `core/modules/os-posix`.
- **Секреты** — Keychain через `security -i`: значение идёт по stdin (не попадает в `ps`) и хранится в base64.
- **Данные** — `~/Library/Application Support` (с приоритетом `XDG_DATA_HOME`); `moveNoReplace` — атомарное «занять и переименовать» вместо GNU `mv`.
- **Окна** — `open -na <Chromium-браузер> --args --app=…`; фокус окна по классу недоступен. Выбор папки — `osascript`.
- **Ввод в CI:** хоткей и меню проверяются настоящими HID-событиями (`CGEvent`: нажатие `Ctrl+Alt+Space`, клик по значку, стрелка и Return) и дополнительно командами `menu N`/`press-hotkey`. Тест лаунчера на macOS работает с `.app` вместо `.desktop`.
- **Проверка** — `.github/workflows/macos.yml` (`macos-15`, Homebrew GTK4): архитектура, `vp test run` (включая `tests/macos-adapter.test.mjs`: каталог, процессы, резидент с GTK-палитрой, меню/хоткей помощника, окно Chromium) и `vio:gtk-test`.

## Windows: как устроено и что не поддерживается

- **Нативные вызовы идут через PowerShell** (`ps.ts`): `Add-Type` компилирует C# при каждом запуске. Окна (`hwnd.ts` — единственное место, где трогаются HWND: GTK-палитра, окна Chromium и трей), секреты и каталог меню Пуск асинхронны. Опрос списка процессов (`list`) не блокирует после первого вызова: устаревший снимок отдаётся сразу, обновление идёт в фоне. Синхронно и точно считаются только `descendants` (список для завершения) и `identity` неизвестного pid. `waitForExit` не опрашивает identity — только `kill(pid, 0)`.
- **Секреты** передаются дочернему PowerShell через stdin (base64), а не через окружение или командную строку.
- **Адрес для браузера** принимается только `http(s)://` и передаётся через окружение, а не вставляется в текст скрипта.
- **Дерево процессов** завершает один `killTree` (`taskkill /T /F`, ожидается его завершение). Job Object не используется: после падения сервера дерево агента остаётся. `ProcessInfo.group/foreground` на Windows `null` (групп процессов нет), `conhost`/`OpenConsole` из списка исключены, иначе каждый PTY выглядел бы занятым.
- **Канал резидента** `\\.\pipe\dev.projector.Launcher.<пользователь>` создаётся с DACL по умолчанию (запись только владельцу, SYSTEM и администраторам); команда дополнительно требует токен из профиля, сравнение с постоянным временем.
- **Запуск агентов** (`os.tools.agentLaunch`): `.cmd`-шимы идут через shell, аргументы с пробелами и метасимволами кавычатся; тот же результат читает `cli/app/agent-host.mjs`.
- **Права файлов:** `0600` заменён на ACL только для текущего пользователя (`os.tools.restrictToOwner`: `icacls /inheritance:r`, `/grant:r *<SID>:F`, `/remove:g` для Administrators, SYSTEM, Everyone, Users, Authenticated Users). Применяется к `integrations.json`, паролю LAN, токену резидента, файлу с токеном для Docker-клонирования и `devcontainer-trust.json`. Системные утилиты (`icacls`, `whoami`, `taskkill`) запускаются из `System32`: Git кладёт в PATH собственный `whoami`.
- **Исполняемость файла:** по расширению из `PATHEXT` и `.ps1` (`os.tools.isExecutableFile`), а не по биту режима.
- **Ссылки из терминала:** каталог берётся у каждого процесса оболочки (Git Bash — цепочка `bash`); тест `windows-adapter` показывает, что Git Bash выставляет Win32-каталог сразу после `cd`, без запуска программы.
- **Docker**: локальным считается контекст с `unix://` или `npipe://`.
- **Архивы**: `archive.py` без `resource` на Windows — память не ограничена, работают лимиты `MAX_BYTES` и `MAX_ENTRIES`.
- **Не проверяется на Windows** (тесты пропущены): симлинки на POSIX-пути, биты исполнения, `.desktop`, GIO, termios-PTY, фейковый `docker`.

## Проверка

`.github/workflows/windows.yml` запускает на `windows-2025` архитектурную проверку и весь `vp test run`, включая `tests/windows-adapter.test.mjs` (реальные процессы, Credential Manager, перенос файлов, окна, дерево процессов). Типы проверяет Linux-job: GIR-типы на Windows не генерируются.

`tests/os.test.mjs` проверяет выбор ОС, отсутствие чужого fallback, каталоги, реальные процессы/cwd и перенос файлов с Unicode и конфликтом имён. Входит в `vp run test`. Архитектурные тесты запрещают прямой доступ к подмодулям Linux и Windows и импорт Node OS-инфраструктуры в браузер.
