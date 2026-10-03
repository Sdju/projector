# Реестр больших файлов

Файл живёт здесь, пока в нём больше 400 строк (для `.vue` — 500). Реестр хранится в `largeFiles` файла `architecture.config.json`; эту таблицу создаёт `vp run architecture -- --registry`. `scripts/check-architecture.mjs` требует запись для каждого файла выше порога, запрещает рост выше потолка и просит снизить потолок или удалить запись после сокращения файла.

| Файл | Строк | Потолок | План разбиения |
| --- | ---: | ---: | --- |
| `src/modules/workspace/ui/ProjectWorkspace.vue` | 950 | 950 | Вынесены SearchPanel, GitPanel, SidebarTabs, WorkbenchToolbar, lib/git-overview, lib/sidebar-resize и lib/open-files. Осталось: раскладка дока и терминалы — в composable, команды редактора — в отдельный файл, сессия — в composable, блок дока из шаблона — в компонент. |
