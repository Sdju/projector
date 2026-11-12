# CLI

`projector` — лаунчер и управляющий клиент локального сервера Projector. Команда работает из checkout через `./bin/projector`, после установки — как `projector`.

CLI запускает сервер по требованию, открывает проекты, показывает каталог и состояние процессов, ищет по лаунчеру и перезапускает сервер. Файлы, Git, терминалы и чаты агентов остаются в веб-интерфейсе.

## Команды

| Команда                      | Что делает                                                           |
| ---------------------------- | -------------------------------------------------------------------- |
| `projector`                  | Открывает палитру; сервер запускается, если его нет                  |
| `projector open [проект]`    | Открывает проект или палитру без аргумента                           |
| `projector projects`         | Показывает сохранённые проекты; работает и при остановленном сервере |
| `projector status [проект]`  | Показывает состояние сервера, проектов и процессов                   |
| `projector run [проект]`     | Запускает основную команду проекта                                   |
| `projector stop [проект]`    | Останавливает команду проекта                                        |
| `projector search <запрос>`  | Ищет приложения, проекты и папки через лаунчер                       |
| `projector start`            | Запускает сервер без открытия окна                                   |
| `projector restart`          | Перезапускает сервер; если он остановлен — запускает                 |
| `projector quit`             | Завершает сервер, терминалы и дочерние процессы                      |
| `projector toggle`           | Показывает или скрывает палитру                                      |
| `projector mode [dev\|prod]` | Показывает или переключает режим сервера                             |
| `projector settings`         | Открывает страницу настроек                                          |
| `projector logs`             | Показывает путь к журналу сервера                                    |
| `projector version`          | Показывает версию                                                    |
| `projector help`             | Показывает справку                                                   |

Псевдонимы: `projects` = `list` = `ls`, `start` = `serve`.

## Проект

Цель команд `open`, `run`, `stop` и `status`:

- локальный путь: `.`, `../app`, `~/code/app`, абсолютный путь;
- id или имя сохранённого проекта;
- `gh:/owner/repository` — GitHub в readonly;
- `gl:/<instance>/<group>/<project>` — GitLab в readonly.

Без цели `run` и `stop` ищут проект, содержащий текущую папку. `status` без цели показывает сервер и все проекты, `open` без цели открывает палитру.

Локальная папка регистрируется как проект при первом `projector open`. Папка не обязана быть Git-репозиторием.

```bash
projector open .
projector open ~/code/app --window
projector open gh:/owner/repository
projector run . --command test
projector stop .
projector status .
```

## Параметры

| Параметр            | Значение                                       |
| ------------------- | ---------------------------------------------- |
| `--browser`         | Открыть в браузере                             |
| `--window`          | Открыть в отдельном окне Chromium              |
| `--native`          | GTK-палитра для открытия лаунчера              |
| `--tray`            | Запустить только резидент в трее; без проекта  |
| `--lan` / `--local` | Разовый сетевой режим для запускаемого сервера |
| `--server`          | Сервер в foreground; используется с `start`    |
| `--command <id>`    | Команда проекта для `run`                      |
| `--json`            | Машиночитаемый вывод                           |
| `--quiet`, `-q`     | Не печатать обычные сообщения                  |
| `--help`, `-h`      | Справка                                        |
| `--version`, `-v`   | Версия                                         |

`--lan` и `--local` действуют только на новый процесс сервера и не сохраняются. Для уже работающего сервера используйте настройки или `projector restart`.

## JSON

`projects`, `status`, `search`, `run`, `stop`, `open`, `start`, `restart` и `quit` поддерживают `--json`. Ошибки по-прежнему печатаются в stderr, а команда завершается с ненулевым кодом.

```bash
projector projects --json
projector status --json | jq '.running'
projector search opencode --json
```

`projects` и `status` не запускают сервер: при остановленном сервере они читают `projects.json` и показывают проекты как остановленные.

## Сервер

- Один сервер на машину: повторный запуск использует работающий процесс через `launch.lock` и `/api/health`.
- `projector start` поднимает сервер в фоне; `projector start --server` — в foreground с выводом в текущий терминал. `projector restart` запускает остановленный сервер.
- Ожидание готовности — до 90 секунд: первый запуск после `pnpm install` пересобирает зависимости Vite. Лог — `server.log` в каталоге данных.
- Открытие окна переживает перезапуск dev-сервера: CLI повторяет запрос до 4 раз и ждёт ответ палитры до 60 секунд.
- `projector mode prod` в checkout сначала собирает `dist`; при ошибке сборки работающий сервер не останавливается.
- Смена режима и `projector quit` завершают терминалы и дочерние процессы.

Данные: `$XDG_DATA_HOME/projector` или `~/.local/share/projector`.

## Устройство

CLI написан на TypeScript и использует FEOD preset `cliLayers`, а не `libraryLayers`:

- `packages/cli/app` — только точки входа: `launch.ts`, `restart.ts`, `desktop.ts`, `agent-host.ts`, `fix-node-pty.ts`, `import-companion-key.ts` и `install-desktop.ts`;
- `packages/cli/commands` — независимые обработчики команд: `open`, `projects`, `status`, `search`, `run`, `server`, `logs`;
- `packages/cli/modules` — `arguments`, `api`, `projects`, `command-runtime`, `server` и `server-process`; каждый доступен только через свой `index.ts`;
- `packages/cli/common` — общий вывод: JSON и таблицы.

`app` может импортировать `commands`, `modules` и `common`; `commands` — только `modules` и `common`; `modules` — только `modules` и `common`. Границы проверяет `vp run architecture`.

В checkout запускается исходный `.ts` через Node 24; `vp run build:distribution` компилирует CLI в `.js` для npm-пакета. `bin/projector` выбирает существующий entrypoint, поэтому работает и из checkout, и из установленного пакета.
