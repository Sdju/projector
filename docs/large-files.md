# Реестр больших файлов

Файл живёт здесь, пока в нём больше 400 строк (для `.vue` — 500). Реестр хранится в `largeFiles` файла `architecture.config.json`; эту таблицу создаёт `vp run architecture -- --registry`. `scripts/check-architecture.mjs` требует запись для каждого файла выше порога, запрещает рост выше потолка и просит снизить потолок или удалить запись после сокращения файла.

| Файл | Строк | Потолок | План разбиения |
| --- | ---: | ---: | --- |
| `src/modules/workspace/ui/ProjectWorkspace.vue` | 633 | 633 | Вынесены панели и lib: git-overview, sidebar-resize, open-files, workbench-layout, editor-commands, workspace-session. Осталось: блок дока из шаблона и стили — в компонент. |
