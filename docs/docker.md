# Docker

Ограниченное окружение проекта: управляемый `docker run`, а не реализация спецификации Dev Containers. Конфигурация репозитория сама по себе не исполняется.

## Модель окружения

- Окружение хранится в `Project.environment` (`projects.json`): Docker context, image, network, ports. Только локальные контексты (`unix://`, `npipe://`); удалённые SSH/TCP недоступны. Projector не меняет глобальный context.
- Файлы лежат в папке пользователя и монтируются в `/workspace`; служебного каталога `$XDG_DATA_HOME/projector/workspaces` нет. Дерево, редактор и поиск работают с хостовым backend. Rootfs, HOME и `/tmp` контейнера — не хранилище проекта; named volumes потребуют отдельного filesystem provider.
- Сеть по умолчанию `none`. `bridge` открывает интернет **и локальную сеть**. До пяти TCP-портов публикуются на случайных портах `127.0.0.1`; сервер приложения должен слушать `0.0.0.0` внутри. Ссылки — `ide.environment.port.open`.
- Контейнер: UID/GID пользователя, без root, capabilities, повышения привилегий, HOME хоста и Docker socket; rootfs только для чтения; 2 CPU, 2 GiB памяти без swap, 256 процессов; единственный bind mount — папка проекта.
- Контейнер принадлежит PTY-сессии или вызову инструмента и удаляется вместе с ними; штатный выход сервера удаляет свои контейнеры. После SIGKILL интерактивные терминалы закрываются сами, неинтерактивные убирает очистка при следующем старте по меткам `io.projector.environment` и `io.projector.server` (pid и время запуска владельца). Чужие контейнеры и контейнеры живого Projector не затрагиваются. Очистка — один раз на процесс, не при HMR.
- Отказ Docker никогда не приводит к запуску на хосте. Абсолютной защиты от вредоносного кода нет: Docker делит ядро хоста; дисковых квот и суммарного лимита контейнеров нет.

## Клонирование GitHub

- По умолчанию образ `node:24-bookworm`, сеть для запуска выключена. Можно выбрать другой доверенный образ с Bash и Git или локальный запуск; панель Docker для этого не нужна. При отсутствии образа Projector скачивает его до клонирования.
- Фоновая задача: `POST /api/integrations/github/clone-jobs`, статус, отмена `DELETE`. Фазы: проверка Docker и образа → скачивание → клонирование → добавление проекта. «Прервать» (`ide.github.repository.clone.abort`) останавливает скачивание или `git clone`, удаляет контейнер и временную папку; проект не регистрируется.
- `git clone` идёт в ограниченном контейнере с временно включённой сетью; GitHub token — только этому контейнеру через временный файл `0600`, затем удаляется. В терминалы токен не попадает.
- Shell, команды проекта, Git и Bash агента выполняются в Docker. Внешние агенты тоже запускаются в образе: их нужно установить и авторизовать там самим. Каждый терминал и вызов инструмента — отдельный контейнер с общей папкой проекта; `/tmp` и HOME контейнера временные.

## Доверие к Dev Container

- При наличии `.devcontainer/devcontainer.json` или `.devcontainer.json` с полномочиями сверх модели показывается окно доверия. Конфиг только с `image`, портами, переменными и non-root пользователем решения не требует.
- `initializeCommand`, `privileged`/`capAdd`/`securityOpt`, `runArgs`, `mounts`/`workspaceMount`, `dockerComposeFile` — на компьютере или с доступом к нему; `build`, `features`, `remoteUser: root` — от root при сборке; lifecycle hooks — в контейнере.
- Доверие хранится в `devcontainer-trust.json` (0600) по реальному пути и хешу конфига с Dockerfile и Compose-файлами. Изменение любого отзывает доверие. Конфиг, ссылающийся наружу симлинком, игнорируется.
- Решение принимается только локальным запросом и намеренно не является IDE-командой. Агенту доступны `ide.devcontainer.status`, `ide.devcontainer.review` (решает пользователь), `ide.devcontainer.stop` (`confirm: true`).
- Доверенный проект: терминалы — `devcontainer up` и `devcontainer exec` через `@devcontainers/cli`, контейнер долгоживущий и общий, Projector его не удаляет. Bash агента — `devcontainer exec` в корне проекта (30 с; прерывание отменяет и сборку). Ссылки `/workspaces/<проект>/…` сопоставляются с проектом, пути вне проекта и `..` отклоняются; DnD файлов хоста отключён. Поддерживается один конфиг, вложенные `.devcontainer/<имя>/` не выбираются.

## Compose

- Обнаруживаются `compose.yaml`, `compose.yml`, `docker-compose.yaml`, `docker-compose.yml` в корне. Привязка хранит context, Compose project name, упорядоченный список файлов, profiles и env-файлы; пути — относительно проекта, выход за границы включая symlinks запрещён. Содержимое env-файлов в браузер не возвращается.
- Привязка не запускает код. «Поднять» — `compose up -d`; доступны stop, restart, build, pull, down. Projector не превращает произвольный Compose в песочницу.
- «Остановить» сохраняет контейнеры. «Удалить окружение» требует подтверждения и удаляет контейнеры и сети, volumes остаются (`--volumes` не передаётся). Параллельные операции одного имени в одном context блокируются.

## Панель и терминалы

- Статус обновляется каждые 5 секунд на видимой странице. Start, stop, restart, remove, логи и shell идут через PTY: операция возвращает сессию, успех определяют её `status` и `exitCode`, а не HTTP 201. Shell — `docker exec -it` (`sh` или `bash`).
- Закрытие клиента и перезапуск Projector не останавливают контейнер и задачи exec. Файловые ссылки и DnD путей хоста в Docker-терминалах отключены. CPU/RAM, images/volumes/networks и поток Engine events не реализованы.

## Запуск daemon

`os.tools.dockerStartPlan`: Linux — `systemctl --user start docker` (rootless) или `docker-desktop`, иначе системный `systemctl` (root напрямую, пользователь через `pkexec`); macOS — Docker Desktop/OrbStack или `colima start`; Windows — `Docker Desktop.exe`. После запуска ожидание до 90 секунд (`POST /api/docker/daemon/start`), одновременно идёт один запуск. Для агента это `ide.docker.daemon.start` — изменяющая команда, требует подтверждения.

## Хранение и команды

- Настройки и привязки — в `integrations.json` через integration store, атомарно, `0600`. Секретные переменные не попадают в публичный snapshot; browser storage не используется.
- Scope `docker:<projectId>`: `ide.docker.open`, `.sidebar.open`, `.status`, `.refresh`, `.context.select`, `.container.select`, `.binding.save`, `.logs.read`, `.daemon.start`, `.port.open` и действия `.start`, `.stop`, `.restart`, `.remove`, `.logs`, `.shell`, `.up`, `.composeStop`, `.composeRestart`, `.down`, `.build`, `.pull`. Передавайте полный `containerId`; Compose принимает необязательный `service`; удаление требует `confirm: true`. Scope `docker:settings` — `.settings.status` и `.settings.save`.

## Экспорт из копии

- Копирование и переход в host-режим — разные операции. Сохраняйте `.git`, tracked/untracked, dotfiles и пользовательские файлы; исключения для зависимостей и generated задавайте явно, не выбрасывайте все gitignored данные. Rootfs, процессы и volumes в checkout не входят — для БД нужен отдельный backup.
- Публикуйте временную копию на целевой файловой системе с отказом при коллизии; неявного merge с существующей папкой нет. При ошибке исходники остаются доступными; удаление источника — отдельное действие после успешного экспорта. Переход в host-режим требует остановки сессий и явной смены профиля; host toolchain не считается установленным.

## Проверки

`vp run test:docker` — fixture CLI без daemon, входит в `vp run check`. `vp run test:live` — настоящий Docker (изоляция, порты, очистка, SIGKILL, Dev Container), в `check` не входит. Live не покрывает private clone, реальный OAuth Device Flow, установку AI CLI, Dev Container с Features и Compose.
