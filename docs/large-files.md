# Реестр больших файлов

Файл живёт здесь, пока в нём больше 400 строк (для `.vue` — 500). Реестр хранится в `largeFiles` файла `architecture.config.json`; эту таблицу создаёт `vp run architecture -- --registry`. `scripts/check-architecture.mjs` требует запись для каждого файла выше порога, запрещает рост выше потолка и просит снизить потолок или удалить запись после сокращения файла.

| Файл | Строк | Потолок | План разбиения |
| --- | ---: | ---: | --- |
| `src/modules/workspace/ui/ProjectWorkspace.vue` | 1215 | 1215 | Уже вынесены SearchPanel, GitPanel, SidebarTabs, WorkbenchToolbar, lib/git-overview и lib/sidebar-resize. Осталось: состояние вкладок и открытие файлов — в composable, раскладка дока и терминалы — в composable, регистрация команд редактора — отдельно. |
| `src/modules/workspace/ui/FileTree.vue` | 878 | 878 | Выделить drag/selection и контекстное меню в composables, строку дерева — в компонент. |
| `src/modules/agent/ui/AgentChat.vue` | 835 | 835 | Вынести ввод, историю и прокрутку в composables, список сообщений — в компонент. |
| `src/modules/dock/ui/DockTabs.vue` | 559 | 559 | Перенесён из common в dock. Вынести перетаскивание, переименование и переполнение вкладок в composables. |
