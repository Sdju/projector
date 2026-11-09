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
- `common/ui/UiAsyncContent.vue` — загрузка с защитой от устаревших ответов; `common/ui/UiViewerPage.vue` и `UiArticle.vue` — общий scroll-контейнер и ширина detail-вью; `UiDetailHeader.vue` — состояние, заголовок, мета-строка и ссылка на хост.
- `integration-api/RepositoryOverview.vue` + `repository-overview.ts` — нейтральная модель «О репозитории»; GitHub и GitLab только маппят свои payload'ы.
- `integration-api/TokenConnectionForm.vue` — форма токена, команда и readout; `CloneRepositoryDialog.vue` — общий клон-диалог; `useDeviceLogin` + `DeviceLoginPanel.vue` — Device Flow.
- `gitlab-workspace/ui/GitlabWorkspaceGate.vue` — проверка инстанса и статус интеграции; `pages/gl/...` сокращена до маршрутной обёртки.
- `workspace-api/pipeline-stages.ts` — `groupPipelineStages` для `PipelineView` и `PullRequestPipelineStages`.
- `integration-api/remote-workspace.ts` — `useRemoteWorkspace`: загрузка, регистрация профиля, 401/403-ветка, открытие README и cleanup для GitHub и GitLab.
- `viewers/ui/ChangedFileRow.vue` и `viewers/lib/file-diffs.ts` — общий ряд изменённого файла с diff-панелью и общий кэш diff; `CommitFiles` и `PullRequestFiles` маппят только свои данные.
- `issues/lib/change-tree.ts` — построение, фолдинг и флаттен дерева снимка с тестами. Решение: `ChangesTree` и `GitChangesTree` остаются раздельными — у них разные модели данных и взаимодействия; общий компонент потребовал бы булевый набор режимов.
- `common/utilities/use-async-data.ts` и `common/ui/UiLoadablePanel.vue` — загрузка с защитой от устаревших ответов и общая панель loading/error; `PullRequestFilesSection` и `CompareTreeSection` больше не дублируют `generation`, `watch` и оболочку.
- `common/utilities/use-section-action.ts` — `ready/busy/error/status`, загрузка, действие и rollback. Переведены `EditorSettings`, `FilesExcludeSettings`, `FavoriteFolders`, `InterfaceSettings` и `PwaSettings`; `NetworkSettings` и `OpenAiGatewaySettings` уже держат lifecycle в своих моделях.
- `agent/model/task-lens.ts` и `agent/model/job-follow.ts` — общий Lens/transcript для строки и вкладки задачи, long-polling и действия фонового задания; `AgentTaskRow`, `AgentTaskView` и `AgentJobTab` стали тоньше.
- `agent/ui/AgentTaskFrame.vue` и `AgentStatusIcon.vue` — общий каркас read-only задачи и один статус-глиф для заданий, задач и активности.
- `agent/model/chat-scroll.ts` — pin/away, ResizeObserver и подгрузка старых ходов; `AgentChat` сократился ниже 500 строк и удалён из реестра больших файлов.
- `agent/lib/composer/suggestions.ts` и `editing.ts` — завершение `@`/`/` и вставка/добавление чипов, текста и цитат; `AgentInput` больше не держит эту логику.
- `agent/lib/composer/drop.ts` — drop/paste, пути из дерева, загрузка картинок и root проекта; `AgentInput` оставил только CodeMirror-хост, команды и expose.
- Решение: `ChatController` остаётся в `AgentChat` как композиционный корень. Фабрика с ~40 опциями перенесла бы строки, но не уменьшила бы связанность.
- Удалены мёртвые `resize`-заглушка, несовпадающие `prefers-reduced-motion`, неиспользуемый `const props`, локальные `.sr-only`, мёртвые `.muted`/`.hint`/`.field`/`.link`.
- `ReleaseView` переведён на `UiMessage tone="danger"`; `ArchiveViewer` — на `sizeLabel` и `UiEmpty`; `999px` заменены на `var(--r-full)`.
- Реестр больших файлов синхронизирован: `AgentChat.vue` — 502, `projector-backend.ts` — 409, `gitlab/browser.ts` — 402.

## Приоритет P2

- [ ] **AgentChat — остаточные компоненты.** Скролл, подсказки, drop/paste и upload вынесены; `ChatController` осознанно оставлен композиционным корнем. Осталось: `AgentTurn` (14 props, 7 boolean, 11 emits), `AgentSessions` (10 props), `AgentActivityDock` (9 `:deep`), markdown-тема заперта в `AgentMessage` (38 `:deep`).
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

1. Декомпозиция `AgentChat` и `AgentInput`.
2. Виджеты, графики и `common/ui`.

## Замечания

- `AgentChat.vue` — ровно 502 непустых строк script при потолке 502: формально проходит, запаса на рост нет.
