# Аудит `.vue`: избыточность и переиспользование

Рабочий документ по разбору 270 SFC в `packages/client`. Ссылки на устройство — в [архитектуре](../architecture.md) и [реестре больших файлов](../large-files.md); здесь только открытые пункты.

## Как считали

- Все 270 файлов прочитаны по группам; метрики — скриптом: объём секций, props, CSS-правила, попарное сходство нормализованных правил и 4-словных шинглов.
- Всего 46 431 строка: script 18 693, style 13 662, template 10 840. Стили — 29,4% кода.
- 234 файла со scoped-стилями; `:deep` — 186 вхождений в 26 файлах; `!important` — 13; хардкод-`px` — 1 309 против 3 626 `var()`; hex-цвета только в 7 файлах.
- 106 файлов с props (671 пропс); 23 файла с >8 props, 11 — с >10.
- 28 файлов со стилями >120 строк, 19 скриптов >200 строк, 4 шаблона >150 строк.

## Уже вынесено

- `common/ui/UiSettingsSection.vue` — общая оболочка секции настроек: активация scope, одна строка ошибки. Используется в 9 формах агента и ролей.
- `agent/ui/AgentJsonSettings.vue` — JSON-редактор MCP и хуков; `AgentMcpSettings` и `AgentHooksSettings` сократились примерно вдвое.
- `common/ui/UiListSection.vue` — оболочка сайдбар-списка: заголовок со счётчиком, фильтр, loading/error/empty, «ещё». Используется в `TrackerPanel`, `PipelinesPanel`, `ReleasesPanel`; три панели больше не держат свои копии CSS.
- `common/ui/UiListRow.vue` — строка списка; используется в `TrackerRow`, `ReleaseRow`, `PipelineRow`.
- Удалены мёртвые `resize`-заглушка, несовпадающие `prefers-reduced-motion`, неиспользуемый `const props`, локальные `.sr-only`, мёртвые `.muted`/`.hint`/`.field`/`.link`.
- `ReleaseView` переведён на `UiMessage tone="danger"`; `ArchiveViewer` — на `sizeLabel` и `UiEmpty`; `999px` заменены на `var(--r-full)`.
- Реестр больших файлов синхронизирован: `AgentChat.vue` — 502, `projector-backend.ts` — 409, `gitlab/browser.ts` — 402.

## Приоритет P1

- [ ] **GitHub/GitLab — презентационный слой.** `GithubClone ↔ GitlabClone` (CSS идентичен, различаются API-база и тексты), `GithubWorkspace:109 ↔ GitlabWorkspace:146`, `GithubSettings ↔ GitlabSettings` (6 методов Device Flow), `GithubRepositoryInfo ↔ GitlabRepositoryInfo` (116 одинаковых строк CSS), `GithubConnection ↔ GitlabConnection`, оба `RepositoryInfoLoader`. `pages/gl/projects/[...gitlabPath].vue` — 366 строк против 13 у gh-страницы. Вынести `RepositoryOverview`, `RepositoryInfoLoader`, `TokenConnectionForm`, `DeviceLoginPanel`, `CloneRepositoryDialog`; маппинг API оставить в модулях.
- [ ] **Detail-вью и стадии.** `TrackerDetail ↔ ReleaseView ↔ PipelineView ↔ JobView` (общий `.article` 880px, `.state`, `.meta`, `.external`); `PipelineView:37-49 ↔ PullRequestPipelineStages:25-42` (~70 строк логики стадий). Вынести `UiDetailShell` и `lib/stages.ts`.
- [ ] **Изменённые файлы.** `CommitFiles:161-267 ↔ PullRequestFiles:266-369` (~86% CSS), `commit-diffs.ts ≈ pull-diffs.ts`, `ChangesTree` (490) + `GitChangesTree` (279) — две реализации дерева, `PullRequestFilesSection ↔ CompareTreeSection` (style 0.91). Вынести `ChangedFileList`, `ChangedFileTree`, `useFileDiffs`.

## Приоритет P2

- [ ] **Scaffold настроек вне агента.** `ready/busy/error/status + save/rollback` повторён в `InterfaceSettings`, `FavoriteFolders`, `EditorSettings`, `FilesExcludeSettings`, `PwaSettings`, `NetworkSettings`, `OpenAiGatewaySettings`. Общий lifecycle уже есть в `integration-api/operation.ts`. Вынести `useSectionAction` и перевести секции на `UiSettingsSection`.
- [ ] **AgentChat.** 924 строки, 502 непустых строк script при потолке 502; 15 ответственностей; свой `.chat-log` вместо `UiScrollArea`. Вынести сборку `ChatController`, скролл, drop, подсказки. Рядом: `AgentInput` (587/444), `AgentTurn` (14 props, 7 boolean, 11 emits), `AgentSessions` (10 props), `AgentActivityDock` (9 `:deep`), markdown-тема заперта в `AgentMessage` (38 `:deep`).
- [ ] **Задачи.** `AgentJobTab ↔ AgentTaskView` — общий каркас read-only вкладки; `AgentTaskRow ↔ AgentTaskView` — общая обвязка `useAgentLens`. Вынести `AgentTaskFrame`, `useTaskLens`, `useJobFollow`, `AgentStatusIcon`.
- [ ] **Виджеты и графики.** `Line` (485, chart-движок, clamp продублирован 3×), `UsageLine ↔ UsageBarChart` (style 0.59), `UsageDonut ↔ Donut`, `Field` (15 props, дублирует `Checks/Tabs/Slider/Input` и `UiField`), `Form ↔ IntelligentForm`, 5 `*UsageIndicator`, 5 копий прогресс-бара. Вынести `ChartFrame`, `UiMeter`, `Field`-диспетчер, общий `Form`.
- [ ] **`common/ui`.** Четыре реализации «поверхности» (`UiCard`, `UiPopupSurface`, `UiDialog`, тост `UiNoticeHost`); `ContextMenu` рендерит строку меню дважды; несовместимые API раскладок (`UiInline` считает `gap * 4` px, `UiActionRow` мапит `1.5 → 6px`); текстовые примитивы повторяют `size/space` inline-стилями; `ImageModal` — 9 `!important`; `UiStringList` — 10 props на одного потребителя; `FileIcon` — размеры захардкожены 6 раз.

## P3

- [ ] Вынести hex-палитру `AgentContextMeter` в `lib/context-palette.ts` на токенах.
- [ ] `FileIcon`: `--file-icon-size` вместо шести пар размеров.
- [ ] Свести `.note` (26 файлов) к `UiMessage`/`UiHint`; убрать дубли `.note.error`.
- [ ] Мобильный breakpoint `(max-width: 700px), (max-width: 1050px) and (max-height: 500px) and (pointer: coarse)` скопирован в 9 файлов — вынести в общий слой.
- [ ] `SettingsWorkbench`: дубли `@media (max-width: 700px)` и `@container (max-width: 650px)` на ~54 строки.
- [ ] `ImageModal`: заменить 9 `!important` вариантом `UiDialog` `fullscreen/flush`.
- [ ] `DockTabs`: 19 props, тип `commandHandlers` разошёлся с `lib/tab-commands.ts`; проверить `renameable` и `closeSaved`.

## Порядок работ

1. GitHub/GitLab презентационный слой.
2. Detail-вью и стадии.
3. Изменённые файлы и деревья.
4. Scaffold настроек вне агента.
5. Декомпозиция `AgentChat`/`AgentInput`/задач.
6. Виджеты, графики и `common/ui`.

## Замечания

- `AgentChat.vue` — ровно 502 непустых строк script при потолке 502: формально проходит, запаса на рост нет.
