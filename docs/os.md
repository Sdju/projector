# Адаптер ОС

`core/modules/os/index.ts` — единственный публичный вход для системных операций CLI, сервера и native. Браузер и доменные модули `core` не могут его импортировать.

```ts
import { os } from '../../../core/modules/os/index.ts'

os.platform                      // process.platform, определяется при загрузке
os.supported                     // сейчас true только для Linux
os.capabilities.processInspection
const processes = os.processes.list()
const cwd = await os.processes.workingDirectory(pid, projectPath)
await os.tools.moveNoReplace(source, destination)
```

## Структура

```text
core/modules/os/
  index.ts                  публичный API и типы
  os.ts                     выбор адаптера, capabilities и единый фасад
  contract.ts               процесс и интерфейс контроллера палитры
  modules/linux/
    index.ts                закрытый API Linux и ленивые загрузчики
    directories.ts          XDG, shell и диалоги выбора папки
    processes.ts            /proc, PID identity, потомки, cwd и сигналы
    tools.ts                GNU mv, Python и ripgrep
    windows.ts              браузер и управление X11-окнами
    install-desktop.ts      desktop entry, иконки и команда запуска
    catalog.ts              GIO-каталог и запуск .desktop
    bus.ts                  session D-Bus
    shortcut.ts              KDE KGlobalAccel
    tray.ts                 StatusNotifierItem / DBusMenu
    resident.ts             desktop lifecycle и D-Bus command endpoint
```

Linux-подмодуль приватен для фасада. При добавлении другой ОС реализация регистрируется в `createOs`; потребители сохраняют вызовы `os.*`. Фабрика экспортирована для проверки выбора платформы. Singleton `os` выбирает систему один раз, а пользовательские настройки окружения (например, XDG и SHELL) читаются при обращении.

## Ответственность API

| API | Что адаптирует |
| --- | --- |
| `dataHome`, `desktopPaths`, `homeDirectory`, `shell` | Пользовательские каталоги и командную оболочку |
| `processes` | Список процессов, потомков, identity для защиты от повторного использования PID, cwd, сигнал и ожидание завершения |
| `tools` | Перенос без перезаписи, изолированный Python helper и поиск ripgrep |
| `windows` | Открытие браузера/app-окна, поиск, активацию, скрытие и закрытие палитры |
| `catalog` | Ленивую загрузку GIO-каталога и иконок внутри native-процесса с GI loader |
| `shortcutStatus`, `shortcutAvailable`, `desktopPid` | Desktop-интеграцию без загрузки GTK |
| `runDesktop` | Resident; приложение передаёт каталог настроек и фабрику контроллера палитры |
| `installDesktop` | Установку из текущего checkout, с учётом XDG и пробелов в пути |

`moveNoReplace` не перезаписывает существующую запись. GNU mv при совпадении может успешно завершиться, оставив источник на месте: вызывающий код проверяет результат переноса и сообщает о конфликте. Проверки допустимости путей и ошибки HTTP остаются в workspace, а не в OS-адаптере.

## Загрузка и ограничения

Импорт `os` не загружает GTK, GIO или D-Bus и не создаёт соединения. Native-компоненты загружаются по буквальным file URL: это сохраняет ленивость при сборке Vite-конфигурации; архитектурный checker проверяет такие зависимости.

Для неподдерживаемых ОС `supported` и capabilities равны false. Список процессов возвращает `null`, сведения о хоткее показывают отсутствие поддержки. Операции с отсутствующей реализацией выбрасывают `UnsupportedPlatformError` с кодом `ERR_OS_UNSUPPORTED`, а не запускают Linux-команды.

Capabilities означают наличие реализации, а не установленность GTK/утилит или доступность display. Linux по-прежнему требует системных зависимостей; автоматический хоткей зависит от KDE, управление app-окном — от X11. Bash bootstrap и renderer `vio` остаются платформенными. Этот слой изолирует зависимости, но сам по себе не реализует поддержку Windows/macOS.

Порт сервера и модель хранения проектов — настройки приложения; они не относятся к OS-адаптеру. Импорт ключей ai-companion теперь принимает путь аргументом:

```bash
node cli/app/import-companion-key.mjs /path/to/providers.json
```

## Проверка

`tests/os.test.mjs` проверяет выбор ОС, отсутствие Linux fallback, XDG, реальные процессы/cwd и перенос файлов с Unicode и конфликтом имён. Входит в `vp run test`. Архитектурные тесты запрещают прямой доступ к Linux-подмодулю и импорт Node OS-инфраструктуры в браузер.
