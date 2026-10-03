# Реестр больших файлов

Файл живёт здесь, пока в нём больше 400 строк (для `.vue` — 500). Реестр хранится в `largeFiles` файла `architecture.config.json`; эту таблицу создаёт `vp run architecture -- --registry`. `scripts/check-architecture.mjs` требует запись для каждого файла выше порога, запрещает рост выше потолка и просит снизить потолок или удалить запись после сокращения файла.

| Файл | Строк | Потолок | План разбиения |
| --- | ---: | ---: | --- |
| `src/modules/workspace/ui/ProjectWorkspace.vue` | 785 | 785 | Вынесены SearchPanel, GitPanel, SidebarTabs, WorkbenchToolbar и lib: git-overview, sidebar-resize, open-files, workbench-layout. Осталось: команды редактора — в отдельный файл, сессия — в composable, блок дока из шаблона — в компонент, стили — по компонентам. |
