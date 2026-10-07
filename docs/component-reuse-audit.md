# Дубли Vue-компонентов: открытые задачи

Статический аудит от 7 октября 2026 года; нерешённые находки сверены с исходниками после первых четырёх пакетов исправлений. Это список кандидатов на рефакторинг, а не обязательные задачи: перед работой перечитайте указанные файлы, потому что код мог измениться. Закрытые находки (общий `UsageIndicator` и `usage-windows` в `agents-integration/_`, `network/client.ts` и `network/model.ts`, `common/ui/UiIsland.vue` с `common/utilities/island-menu.ts`, `viewers/lib/tracker-detail.ts`, `projectContainers` в Docker-модели, удаление `ProjectForm` и `AgentDock`) описаны в коде и истории Git.

Правила для любого пункта: общая абстракция выносится только при подтверждённом совпадении поведения; провайдеры и владельцы остаются тонкими адаптерами; FEOD и IDE-команды сохраняются (см. [архитектуру](architecture.md), [SDK команд](ide-commands.md)). Для dock и редактора не меняйте стабильную идентичность `DockSlot`, `PanelHost` и keepAlive-содержимого: потеря фокуса, курсора, прокрутки и xterm-процессов будет регрессией. Для UI-изменений нужна проверка в реальном браузере (GTK для палитры).

## R5 · Настройки GitHub/GitLab и авторизация GitHub

- `src/modules/github/GithubSettings.vue` и `src/modules/gitlab/GitlabSettings.vue` содержат одинаковую функцию `action` (сброс error/message, busy, try/catch/finally), загрузку интеграции, сохранение и connect/disconnect токена. `TokenReveal` уже общий.
- `src/modules/github/GithubConnection.vue` — второй путь включения GitHub с POST `/github/auth`. Отличие: он обрезает токен через `trim`, `GithubSettings` передаёт исходную строку.

Куда: общая модель состояния и операций — в `integration-api`; GitHub-специфичный connect и OAuth Device Flow остаются в `github`, URL/scope/import — в `gitlab`. GitLab не может импортировать реализацию GitHub (FEOD).

## R6 (остаток) · Отображение статусов Docker

`DockerPanel.vue` и `DockerSidebar.vue` по отдельности выводят `service || name`, состояния, exitCode и unhealthy. Можно вынести небольшой formatter или status-компонент, сохранив разную компоновку.

## R7 · Жизненный цикл drag у разделителей

Pointer drag реализован отдельно в `dock/ui/DockTree.vue`, `workspace/modules/git/ui/GitSplitter.vue`, `workspace/modules/viewers/ui/CommitFileDiff.vue`, `SplitPanes.vue` и `workspace/lib/sidebar-resize.ts` (последний — на глобальных window listeners без pointer capture). Повторяются фильтр кнопки, capture, стартовые координаты, move/finish и шаг с клавиатуры.

Куда: вынести только механизм pointer drag, cleanup и общие ARIA/keyboard-примитивы; clamp, collapse и reset остаются в своих моделях. `DockTree` не обрабатывает `lostpointercapture` и не сбрасывает `body.cursor/userSelect` при unmount — при реализации проверьте отмену drag и размонтирование. `SplitPanes` не заменяет все разделители: он объединяет только HTML/SVG preview.

## R8 · Поля настроек проекта

`catalog/ui/settings/ProjectGeneralSection.vue`, `ProjectLaunchSection.vue`, `ProjectScenariosSection.vue` отдельно определяют `.section`, `.field`, gap и цвет подписи. `common/ui/UiField.vue` выводит `<div><span>` без `<label>`, поэтому простая подстановка потеряет связь label с input: сначала доработайте `UiField`. Доменные секции в один компонент не объединять.

## R10 · Копирование и feedback

`network/LanInfoPanel.vue` и `agent/ui/AgentChat.vue` вызывают `navigator.clipboard` со своим feedback, а `CommitMeta` и `GitHistory` используют `copyWithNotice` из `common/utilities/notice.ts`. Для LAN-панели можно взять `copyWithNotice` с якорем кнопки. Чат (copied-id, галочка) — отдельная UX-модель; `TerminalView` и дерево файлов не объединять.

## R11 · Политика действий web/GTK launcher

Поиск, данные и запуск уже общие через `core/modules/launcher`. Повторяется состояние выбранного detail action и политика избранного в `src/pages/index.vue` и `native/modules/desktop/Palette.vue`. Условия уже расходятся: у web `toggleFavorite` исключает github и gitlab, у native — только github. Перенести правила выбора и допустимости действий в launcher model; GTK keyval, DOM-события, фокус, прокрутку и скрытие окна оставить платформенному UI. `ProjectSwitcher.vue` сопоставлять после стабилизации общей политики.

## R3 (остаток) · Остров вне миграции

`ProjectSwitcher.vue` открывает остров, но содержит поиск и launcher model; переводить на `UiIsland` только каркас. `ContextMenu.vue` использует Popover API, ожидание отпускания правой кнопки и typeahead: заменять его целиком нельзя.
