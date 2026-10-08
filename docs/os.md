# Адаптер ОС

`core/modules/os/index.ts` — единственный публичный вход для системных операций CLI, сервера и native. Браузер и доменные модули `core` не могут его импортировать.

```ts
import { os } from "../../../core/modules/os/index.ts";

os.platform; // process.platform, определяется при загрузке
os.supported; // true для Linux и Windows
os.capabilities.nativeDesktop; // GTK-палитра: Linux и Windows
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

Для неподдерживаемых ОС (`darwin` и остальные) `supported` и capabilities равны false. Список процессов возвращает `null`, сведения о хоткее показывают отсутствие поддержки. Операции с отсутствующей реализацией выбрасывают `UnsupportedPlatformError` с кодом `ERR_OS_UNSUPPORTED`, а не запускают команды другой ОС.

Capabilities означают наличие реализации, а не установленность утилит. Linux для трея и глобального хоткея требует KDE (StatusNotifier и KGlobalAccel). На Windows `nativeDesktop` тоже true: палитра запускается через GTK4 из `node-gtk` отдельным процессом, команды между запусками идут по именованному каналу, фокус окна — по HWND. Трей — иконка области уведомлений, хоткей — `RegisterHotKey`; оба живут в резиденте палитры. Каталог меню Пуск читается без GTK (`giLoader === false`). Работают каталоги (`LOCALAPPDATA`, с приоритетом `XDG_DATA_HOME`), процессы, перенос файлов, Git Bash или PowerShell, Credential Manager, меню Пуск и окно Chromium. Запуск на Windows — `bin/projector.cmd`.

Порт сервера и модель хранения проектов — настройки приложения; они не относятся к OS-адаптеру. Импорт ключей ai-companion принимает путь аргументом:

```bash
node cli/app/import-companion-key.mjs /path/to/providers.json
```

## Проверка

`tests/os.test.mjs` проверяет выбор ОС, отсутствие чужого fallback, каталоги, реальные процессы/cwd и перенос файлов с Unicode и конфликтом имён. Входит в `vp run test`. Архитектурные тесты запрещают прямой доступ к подмодулям Linux и Windows и импорт Node OS-инфраструктуры в браузер.
