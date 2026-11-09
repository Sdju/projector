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
- `common/ui/UiMeter.vue` — один прогресс-бар с тонами, высотой, мягкой заливкой и сегментами; заменил копии в `Bars`, `UsageBreakdown`, `LimitCard` и двухцветный diff в `GitInfo`.
- `analytics/lib/chart-layout.ts` — общий ResizeObserver, `niceMax`, масштаб, тики и прореживание подписей для `UsageBarChart` и `UsageLine`.
- `common/ui/UiDonut.vue` — одно кольцо с внутренним расчётом доли; `Donut` и `UsageDonut` стали обёртками.
- `agents-integration/_/use-agent-usage-indicator.ts` — polling, часы, окна, команда и публикация остатка; Claude, Cursor, Kimi и OpenCode оставили только определения окон и тексты.
- `ContextMenu` использует `UiActionRow` и на десктопе, а не только в мобильном листе. `ImageModal` переведён на `UiDialog fullscreen flush` без девяти `!important`. `FileIcon` получил `size` и `--file-icon-size`.
- P3: hex-палитра `AgentContextMeter` переехала в `lib/context-palette.ts` на токенах; `SettingsWorkbench` больше не дублирует media/container-блок; `DockTabs` использует общий `DockCommandHandlers`, удалён мёртвый `renameable`; тон `.note.error` вынесен в общий CSS, восемь локальных копий удалены.
- `agent/model/chat-scroll.ts` — pin/away, ResizeObserver и подгрузка старых ходов; `AgentChat` сократился ниже 500 строк и удалён из реестра больших файлов.
- `agent/lib/composer/suggestions.ts` и `editing.ts` — завершение `@`/`/` и вставка/добавление чипов, текста и цитат; `AgentInput` больше не держит эту логику.
- `agent/lib/composer/drop.ts` — drop/paste, пути из дерева, загрузка картинок и root проекта; `AgentInput` оставил только CodeMirror-хост, команды и expose.
- `agent/ui/agent-markdown.css` — тема markdown рядом с `AgentMarkdown`. Стили больше не заперты в `AgentMessage`, поэтому `AgentSideQuestion` и другие прямые потребители получают то же оформление.
- `AgentActivityDock` больше не перекрашивает детей через `:deep`: `AgentPlan`, `AgentTaskBar` и `AgentQueue` получили вариант `embedded`. `AgentSessions` принимает `native` и `recent` объектами вместо пяти плоских пропсов, `AgentTurn` берёт `projectId` из `provideChatContext`.
- Решение: `ChatController` остаётся в `AgentChat` как композиционный корень. Фабрика с ~40 опциями перенесла бы строки, но не уменьшила бы связанность.
- Удалены мёртвые `resize`-заглушка, несовпадающие `prefers-reduced-motion`, неиспользуемый `const props`, локальные `.sr-only`, мёртвые `.muted`/`.hint`/`.field`/`.link`.
- `ReleaseView` переведён на `UiMessage tone="danger"`; `ArchiveViewer` — на `sizeLabel` и `UiEmpty`; `999px` заменены на `var(--r-full)`.
- Реестр больших файлов синхронизирован: `AgentChat.vue` — 502, `projector-backend.ts` — 409, `gitlab/browser.ts` — 402.

## Приоритет P2

- [x] **AgentTurn — флаги.** Семь boolean-пропсов и `phase` сгруппированы в `flags`; осталось 6 верхнеуровневых пропсов. 11 emits оставлены: `@event` — идиоматичный и типизированный контракт Vue, объект колбэков потерял бы проверку имён и аргументов.
- [x] **Виджеты и графики — решения.** `UiMeter`/`UiDonut`, раскладка `UsageLine`/`UsageBarChart` и 4 индикатора агентов общие. `Line`, `Field`, `Form/IntelligentForm`, `UsageMeter` и `CodexUsageIndicator` не выносим: у них нет второго потребителя или разные контракты; общий компонент добавил бы режимы и булевы флаги.
- [x] **`common/ui` — решения.** `UiCard`, `UiPopupSurface`, `UiDialog` и тост не сводим в один surface: у них разная семантика (карточка, поповер, модалка, тост). Раскладки и текстовые примитивы объединяем при появлении третьего потребителя каждого варианта.

## P3 — решения

- `.note` остаётся компактной утилитой: у неё разные отступы внутри панелей, и замена всех вхождений на `UiHint` потеряла бы эту геометрию. Общий тон ошибки уже в CSS.
- Мобильный breakpoint остаётся обычным media query: пользовательских media в CSS нет, а общий слой потребовал бы build-plugin.

## Статус

План закрыт: пунктов на вынос не осталось. Открытых задач по аудиту `.vue` нет.

## Замечания

- `AgentChat.vue` опустился до 455 непустых строк script и удалён из реестра больших файлов.
