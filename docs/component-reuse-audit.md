# Дубли Vue-компонентов: открытые задачи

Статический аудит от 7 октября 2026 года; нерешённые находки сверены с исходниками 15 октября 2026 года. Это список кандидатов на рефакторинг, а не обязательные задачи: перед работой перечитайте указанные файлы, потому что код мог измениться. Закрытые находки (общий `UsageIndicator` и `usage-windows` в `agents-integration/_`, `network/client.ts` и `network/model.ts`, `common/ui/UiIsland.vue` с `common/utilities/island-menu.ts`, `viewers/lib/tracker-detail.ts`, `projectContainers` в Docker-модели, удаление `ProjectForm` и `AgentDock`, `useIntegrationOperation` в настройках GitHub/GitLab, `usePointerDrag` у разделителей dock, Git, diff и сайдбара, `resolveLauncherAction` для web/GTK-палитры) описаны в коде и истории Git.

Правила для любого пункта: общая абстракция выносится только при подтверждённом совпадении поведения; провайдеры и владельцы остаются тонкими адаптерами; FEOD и IDE-команды сохраняются (см. [архитектуру](architecture.md), [SDK команд](ide-commands.md)). Для dock и редактора не меняйте стабильную идентичность `DockSlot`, `PanelHost` и keepAlive-содержимого: потеря фокуса, курсора, прокрутки и xterm-процессов будет регрессией. Для UI-изменений нужна проверка в реальном браузере (GTK для палитры).

## R6 (остаток) · Отображение статусов Docker

`DockerPanel.vue` и `DockerSidebar.vue` по отдельности выводят `service || name`, состояния, exitCode и unhealthy. Можно вынести небольшой formatter или status-компонент, сохранив разную компоновку.

## R8 · Поля настроек проекта

`catalog/ui/settings/ProjectGeneralSection.vue`, `ProjectLaunchSection.vue`, `ProjectScenariosSection.vue` отдельно определяют `.section`, `.field`, gap и цвет подписи. `common/ui/UiField.vue` выводит `<div><span>` без `<label>`, поэтому простая подстановка потеряет связь label с input: сначала доработайте `UiField`. Доменные секции в один компонент не объединять.

## R10 · Копирование и feedback

`network/LanInfoPanel.vue` и `agent/ui/AgentChat.vue` вызывают `navigator.clipboard` со своим feedback, а `CommitMeta` и `GitHistory` используют `copyWithNotice` из `common/utilities/notice.ts`. Для LAN-панели можно взять `copyWithNotice` с якорем кнопки. Чат (copied-id, галочка) — отдельная UX-модель; `TerminalView` и дерево файлов не объединять.

## R3 (остаток) · Остров вне миграции

`ProjectSwitcher.vue` открывает остров, но содержит поиск и launcher model; переводить на `UiIsland` только каркас. `ContextMenu.vue` использует Popover API, ожидание отпускания правой кнопки и typeahead: заменять его целиком нельзя.
