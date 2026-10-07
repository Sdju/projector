# Аудит переиспользования Vue-компонентов

Снимок: `5cc2723`, ветка `feod-plugin-config`, 7 октября 2026 года.

В инвентаризации 126 SFC: 123 веб-компонента, одна GTK-палитра, один пример vio и одна тестовая fixture. Для каждого разобраны полные `script`, `template` и `style` через `@vue/compiler-sfc`; сопоставлены одинаковые блоки, импорты, дочерние компоненты и обработчики. Кандидаты ниже проверены чтением исходников и связанных моделей. Автоматическое сходство — способ поиска, а не доказательство необходимости общей абстракции.

Это статический аудит. UI и код компонентов не менялись; поведение в браузере и GTK в рамках аудита не проверялось. «Без крупного дубля» означает отсутствие подтверждённого существенного дубля в этом проходе, а не доказательство полной уникальности кода. В конце есть отдельная строка для каждого компонента.

## Подтверждённые участки

### R1 · Высокий · Оболочка индикаторов квот, четыре компонента

- `src/modules/agents-integration/claude/ui/ClaudeUsageIndicator.vue`: состояние и строки tooltip с 46, шаблон с 104, стили с 139.
- `src/modules/agents-integration/cursor/ui/CursorUsageIndicator.vue`: состояние и строки tooltip с 37, шаблон с 91, стили с 126.
- `src/modules/agents-integration/opencode/ui/OpenCodeUsageIndicator.vue`: состояние и строки tooltip с 46, шаблон с 100, стили с 135.
- `src/modules/agents-integration/codex/ui/CodexUsageIndicator.vue`: состояние с 15, шаблон с 45, стили с 77.

Повторяются контейнер индикатора, цветовые классы `tone-*`, иконка, tooltip, его строки, подсказка переключения окна; в трёх провайдерах повторяются цикл окна, расчёт остатка, оттенка и countdown. Отличия — данные API, набор/порядок окон, длительность и признаки исчерпания; Codex не переключает окна.

`UsageMeter`, `useUsagePolling`, `usagePaceTone`, `resetCountdown` и `publishAgentUsage` уже общие. Следующий шаг — общая оболочка индикатора в `agents-integration/_` и модель представления окон. Провайдеры должны остаться тонкими адаптерами. Команды `ide.<provider>.usage.window.cycle` сохранить с отдельными описаниями; не превращать всё в один компонент с ветками по имени провайдера. Сейчас четыре компонента занимают суммарно 751 строку; это размер кандидатов, не обещание удалить 751 строку.

### R2 · Высокий · Сетевые настройки и LAN-панель

- `src/modules/network/NetworkSettings.vue:21`: `load`, `health`, `waitForRestart`, `apply`, смена/сброс пароля.
- `src/modules/network/LanInfoPanel.vue:19`: те же операции и состояния `busy/error/status/password`.

Оба реально используются: первый в реестре настроек, второй во вкладке workspace. Полностью совпадают проверка PID и ожидание restart; почти одинаковы POST, разбор ошибок, reload и очистка пароля. Повторяется и UI редактирования пароля с пояснениями. Тип `NetworkState` объявлен дважды и уже различается наличием `lanUrls`.

Вынести API и модель операций в модуль `network`; форму пароля при необходимости вынести в небольшой локальный компонент. Режим сети, список адресов и конкретную компоновку оставить в владельцах. Общую операцию подключить к IDE-командам: сейчас кнопки обоих компонентов напрямую вызывают локальные функции.

### R3 · Высокий · Всплывающие меню рабочего пространства

- `src/modules/runner/ui/RunMenu.vue:106`.
- `src/modules/workspace/ui/LayoutMenu.vue:38`.
- `src/modules/workspace/ui/NewSessionMenu.vue:57`.

Три раза реализованы `open/trigger/island/origin`, открытие после `nextTick`, вычисление позиции, начальный фокус, возврат фокуса, Escape, стрелки, outside-click, закрытие при resize/blur, Teleport и оболочка `.island`. Повторяется переключение в мобильный bottom sheet.

Выделить в `common/ui` оболочку острова и небольшой composable управления фокусом/открытием. Параметризовать сторону якоря, первый элемент фокуса и разрешённые клавиши; содержимое оставить слотами. Уже есть различия: NewSessionMenu закрывается по Tab, а RunMenu и LayoutMenu такой ветки не имеют. Это расхождение политики, не автоматически подтверждённый runtime-баг.

`ProjectSwitcher` тоже открывает остров, но содержит поиск и launcher model; подключать только общий каркас после первых трёх. `ContextMenu` использует нативный Popover API, ожидание отпускания правой кнопки и typeahead: заменять его на тот же виджет целиком нельзя.

### R4 · Высокий · Загрузка деталей tracker

- `src/modules/workspace/modules/viewers/ui/IssueView.vue:11`.
- `src/modules/workspace/modules/viewers/ui/PullRequestView.vue:15`.
- `src/modules/workspace/modules/viewers/ui/DiscussionView.vue:15`.

Три раза повторяются `detail/loading/error/generation`, очистка перед запросом, `workspaceRequest`, защита от устаревшего ответа, catch/finally и watch по projectId/number. Отличаются тип ответа, action и текст ошибки.

Вынести `useTrackerDetail<T>` в `viewers/lib`; преобразование комментариев, PR reviews/files и ответы discussions оставить в адаптерах. Общий UI уже существует: `TrackerDetail`, `TrackerComments`, `TrackerReactions`. `CommitOverview` и `GithubRepositoryInfoLoader` похожи по жизненному циклу загрузки, но расширять composable до них стоит только при ясном контракте reset/subject/пустого repository.

### R5 · Средний · Настройки GitHub/GitLab и повторная авторизация GitHub

- `src/modules/github/GithubSettings.vue:23`: `apply/action`, загрузка интеграции, сохранение, token connect/disconnect.
- `src/modules/gitlab/GitlabSettings.vue:18`: те же блоки и аналогичные формы/стили.
- `src/modules/github/GithubConnection.vue:22`: второй flow включения интеграции и POST `/github/auth`.

`action` скопирован буквально: сброс error/message, busy, try/catch/finally. Повторяются status, enabled/directory, токен и действия connect/disconnect. `TokenReveal` уже переиспользуется. Авторизация GitHub в двух компонентах различается: GithubConnection обрезает токен через trim, GithubSettings передаёт исходную строку; оба проверяют непустой trim.

Общую модель состояния/операций размещать в `integration-api`; GitHub-специфичный connect — в модуле `github`. OAuth device polling оставить в GitHub, URL/scope/import — в GitLab. Общий UI ограничить полями подключения и статусом. FEOD не позволяет GitLab импортировать implementation GitHub.

### R6 · Средний · Docker sidebar повторяет фильтр модели

- `src/modules/docker/ui/DockerSidebar.vue:7`.
- `src/modules/docker/model.ts:37`.

Sidebar повторно фильтрует snapshot.containers по binding.context/context и binding.name/project. Модель делает тот же фильтр, но дополнительно учитывает переключатель `all`; поэтому просто взять её существующее `containers` для sidebar нельзя — режим «Все контейнеры» должен остаться только у панели.

Добавить `projectContainers` в общую модель и получить `containers` через `all ? snapshot.containers : projectContainers`. Sidebar использует `projectContainers`. В DockerPanel/Sidebar дополнительно повторяется отображение `service || name`, состояния, exitCode и unhealthy — можно вынести маленький formatter/status-компонент, сохраняя разную табличную и компактную компоновку. `DockerBinding` и команды уже общие.

### R7 · Средний · Жизненный цикл drag у разделителей

- `src/modules/dock/ui/DockTree.vue:50`.
- `src/modules/workspace/modules/git/ui/GitSplitter.vue:31`.
- `src/modules/workspace/modules/viewers/ui/CommitFileDiff.vue:44`.
- `src/modules/workspace/modules/viewers/ui/SplitPanes.vue:32`.
- `src/modules/workspace/lib/sidebar-resize.ts:31` используется ProjectWorkspace.

Повторяются фильтр основной кнопки, preventDefault/focus, pointer capture, стартовая координата/размер, move, finish и клавиатурный шаг. Sidebar использует глобальные window listeners вместо capture. Политики размера разные: доли соседей dock, высота истории, высота diff, доли двух preview-панелей.

Вынести только механизм pointer drag, cleanup и общие ARIA/keyboard primitives. Оставить clamp/collapse/reset в своих моделях. `SplitPanes` уже корректно объединяет HTML/SVG preview; заменять все разделители им нельзя. DockTree не имеет обработчика `lostpointercapture` и cleanup body.cursor/userSelect на unmount; остальные реализации тоже различаются по cancel. При будущей реализации проверить фактическую отмену drag и размонтирование.

### R8 · Средний · Повторяющиеся поля настроек проекта

- `src/modules/catalog/ui/settings/ProjectGeneralSection.vue:9`.
- `src/modules/catalog/ui/settings/ProjectLaunchSection.vue:9`.
- `src/modules/catalog/ui/settings/ProjectScenariosSection.vue:44`.

Три секции отдельно определяют `.section`, `.field`, gap, цвет подписи и обёртку поля. Состояние уже общее через `useProjectSettingsForm`; `SettingsWorkbench` тоже общий.

Использовать единый field/section primitive после доработки `UiField`: сейчас он выводит `<div><span>`, а секции используют `<label>` с корректной связью с input. Простая подстановка текущего UiField потеряет семантику label. Не объединять доменные секции в один большой компонент.

### R9 · Средний · Старые компоненты без внутренних потребителей

- `src/modules/catalog/ui/ProjectForm.vue`, экспорт `src/modules/catalog/index.ts:1`.
- `src/modules/agent/ui/AgentDock.vue`, экспорт `src/modules/agent/index.ts:4`.

Поиск по src/native/tests не обнаружил потребителей, только экспорты. ProjectForm повторяет поля/scenarios и `addCommand/removeCommand` из новой модели project-settings-form; AgentDock отдельно отображает turns/tools вместо AgentTurn/AgentActivity/AgentMessage.

Сначала подтвердить, что публичные экспорты не используются внешними потребителями, затем удалить старые реализации. Создавать общую абстракцию ради компонента, который больше не вызывается, не нужно. Внутренних потребителей нет в текущем снимке; это не утверждение об отсутствии внешних.

### R10 · Низкий · Копирование и feedback

- `src/modules/network/LanInfoPanel.vue:83`: clipboard + локальный status/error.
- `src/modules/agent/ui/AgentChat.vue:75`: clipboard + copied-id + timeout.
- `src/modules/workspace/modules/viewers/ui/CommitMeta.vue:19` и `src/modules/workspace/modules/git/ui/GitHistory.vue` уже используют `copyWithNotice` из `common/utilities/notice.ts`.

Для LAN можно переиспользовать имеющийся helper с якорем кнопки. В чате скопированный id и галочка — отдельная UX-модель; если нужен единый clipboard primitive, оставить его низкоуровневым и не навязывать notice всем вызовам. TerminalView также использует clipboard, но отвечает за ввод/выделение xterm: целиком объединять эти flows не нужно.

### R11 · Средний · Политика действий web/GTK launcher

- `src/pages/index.vue`: detailIndex, выбор detail action, favorites и возврат к списку.
- `native/modules/desktop/Palette.vue`: те же решения через другой toolkit.
- `src/modules/catalog/ui/ProjectSwitcher.vue`: собственная подписка/lifecycle той же launcher model.

Поиск, данные и запуск уже общие через `core/modules/launcher/createLauncherModel`. Осталось повторение состояния выбранного detail action и политики favorite. У web toggleFavorite исключает github и gitlab, у native pin — только github; это конкретное расхождение условий в исходниках.

Перенести общие правила выбора/допустимости действий в launcher model. GTK keyval, DOM KeyboardEvent, фокус, прокрутку и hiding window оставить платформенным UI. Веб-строку результата launcher и ProjectSwitcher можно сопоставить отдельно после стабилизации общей политики; объединение DOM с GTK не подходит.

## Порядок работ

1. R9: проверить контракт и убрать неиспользуемые реализации, чтобы не поддерживать старый UI.
2. R1 и R2: самые прямые дубли представления и операций.
3. R3: общий остров; особенно тщательно проверить фокус, клавиатуру, outside-click и мобильную поверхность.
4. R4 и R6: общий loader tracker и вычисление projectContainers.
5. R5, R7, R8 и R11: отдельные небольшие изменения с сохранением FEOD и IDE-команд.
6. R10: только при согласованной политике feedback.

При реализации: типы, архитектура, соответствующие тесты; для UI — реальный браузер/GTK. Для dock/editor не менять стабильную идентичность `DockSlot`, `PanelHost` и keepAlive-контента: потеря фокуса, cursor/scroll и xterm-процессов будет регрессией.

## Ход исправлений

Первый пакет, 7 октября 2026 года:

- **R4 — выполнено для IssueView, PullRequestView и DiscussionView.** Загрузка вынесена в `viewers/lib/tracker-detail.ts`; провайдеры сохраняют свои action, типы и сообщения об ошибке. Смена проекта/номера и размонтирование отменяют запрос через AbortSignal и запрещают применение устаревшего ответа, даже если провайдер игнорирует отмену. CommitOverview и GithubRepositoryInfoLoader остаются отдельными.
- **R6 — выполнен общий фильтр.** Модель Docker предоставляет `projectContainers`; sidebar использует его, а панель выбирает между ним и всеми контейнерами через `all`. Отображение статусов пока остаётся локальным.
- Проверки: FEOD, сборка с vue-tsc; регрессионные тесты tracker-модели для всех трёх action; Chromium с реальными Vue-компонентами для загрузки/ошибки/восстановления tracker и кликов переключателя Docker, отсутствующей привязки и несовпадения context. Браузерная fixture использует изолированные данные, без обращения к production GitHub/Docker.

Второй пакет, 7 октября 2026 года:

- **R9 — выполнено.** Удалены ProjectForm, AgentDock и их экспорты. Повторный поиск по всему checkout обнаружил только эти экспорты; Projector — приватное приложение без package exports для Vue-модулей, документированного внешнего контракта этих компонентов нет. Рабочие ProjectSettings и AgentChat сохранены.
- **R1 — выполнено.** В `agents-integration/_` добавлены UsageIndicator и модель `usage-windows`: общая оболочка, tooltip, строки квот, расчёт остатка/темпа/countdown и переключение окон. Адаптеры задают данные и конфигурацию окон, сохраняют polling и отдельные IDE-команды с прежними описаниями. Codex использует общую оболочку и представление окна, но остаётся без переключения; длительность берётся из API с недельным fallback. Отсутствующие окна Claude поддерживаются.
- Проверки: FEOD и сборка с vue-tsc; 38 тестов polling/cache и четырёх провайдеров; Chromium fixture с четырьмя настоящими индикаторами, загрузкой, ошибкой HTTP, недоступными/частичными данными, фокусом/tooltip, размерами иконок, переключением без refetch, исчерпанием, API-длительностью Codex и cleanup общей сводки. Ответы квот изолированы от реальных аккаунтов.

Исходные находки и таблицы ниже сохранены как снимок до исправлений, включая пути удалённых компонентов. Следующий пакет — R2; R3, R5, R7, R8, R10 и R11 ещё не закрыты.

## Компонент за компонентом

В таблицах R1–R11 ссылаются на находки выше. «Общий» — уже имеющееся переиспользование; «Локальный» — крупного подтверждённого дубля в этом проходе нет. Небольшое совпадение разметки или CSS само по себе не требует нового компонента.

### `native/modules/desktop`

| Компонент                                            | Строк | Результат | Что проверено                                                             |
| ---------------------------------------------------- | ----: | --------- | ------------------------------------------------------------------------- |
| [Palette.vue](../native/modules/desktop/Palette.vue) |   493 | R11       | GTK-адаптер общей launcher model; повтор политики detail action/favorite. |

### `packages/vio/examples/counter/modules/counter`

| Компонент                                                                   | Строк | Результат | Что проверено                                       |
| --------------------------------------------------------------------------- | ----: | --------- | --------------------------------------------------- |
| [Counter.vue](../packages/vio/examples/counter/modules/counter/Counter.vue) |    41 | Пример    | Демонстрация vio; не объединять с тестовой fixture. |

### `packages/vio/tests`

| Компонент                                        | Строк | Результат | Что проверено                                   |
| ------------------------------------------------ | ----: | --------- | ----------------------------------------------- |
| [Fixture.vue](../packages/vio/tests/Fixture.vue) |    23 | Тест      | Тестовая fixture; похожесть примера намеренная. |

### `src/app`

| Компонент                     | Строк | Результат | Что проверено                                    |
| ----------------------------- | ----: | --------- | ------------------------------------------------ |
| [App.vue](../src/app/App.vue) |   120 | Локальный | Сборка приложения, title/favicon, window events. |

### `src/app/layouts`

| Компонент                                       | Строк | Результат | Что проверено                                                              |
| ----------------------------------------------- | ----: | --------- | -------------------------------------------------------------------------- |
| [AppShell.vue](../src/app/layouts/AppShell.vue) |   364 | Общий     | Разные project picker используют общий PathBar; локальные route/drop glue. |

### `src/common/ui`

| Компонент                                                   | Строк | Результат | Что проверено                                                                          |
| ----------------------------------------------------------- | ----: | --------- | -------------------------------------------------------------------------------------- |
| [ContextMenu.vue](../src/common/ui/ContextMenu.vue)         |   234 | Общий     | Popover API, right-click release, typeahead; R3 относится лишь к отдельным primitives. |
| [EmojiText.vue](../src/common/ui/EmojiText.vue)             |    31 | Общий     | Общий splitEmoji/useGithubEmojis; картинки emoji не равны avatar.                      |
| [EntryDialog.vue](../src/common/ui/EntryDialog.vue)         |   107 | Общий     | Общий ввод/подтверждение для дерева и GitBranchBar.                                    |
| [IconFinishFlag.vue](../src/common/ui/IconFinishFlag.vue)   |    17 | Общий     | Одна реализация SVG-иконки завершённой сессии.                                         |
| [UiAvatar.vue](../src/common/ui/UiAvatar.vue)               |    47 | Общий     | Общая обработка src/error/fallback и размера.                                          |
| [UiButton.vue](../src/common/ui/UiButton.vue)               |   144 | Общий     | Общие варианты кнопок; не заменять им каждую семантическую строку списка.              |
| [UiDialog.vue](../src/common/ui/UiDialog.vue)               |    75 | Общий     | Общий dialog, showModal/close; небольшие watchers клиентов не крупный дубль.           |
| [UiDialogActions.vue](../src/common/ui/UiDialogActions.vue) |    12 | Общий     | Общий контейнер действий диалога.                                                      |
| [UiEmpty.vue](../src/common/ui/UiEmpty.vue)                 |    13 | Общий     | Общее пустое состояние; тексты локальные.                                              |
| [UiField.vue](../src/common/ui/UiField.vue)                 |    26 | R8        | Недостаёт семантики label/for для переиспользования в секциях проекта.                 |
| [UiHint.vue](../src/common/ui/UiHint.vue)                   |    12 | Общий     | Общий текст пояснений.                                                                 |
| [UiKbd.vue](../src/common/ui/UiKbd.vue)                     |    15 | Общий     | Общий рендер сочетаний клавиш.                                                         |
| [UiNoticeHost.vue](../src/common/ui/UiNoticeHost.vue)       |   115 | Общий     | Общий слой уведомлений с якорем.                                                       |
| [UiStringList.vue](../src/common/ui/UiStringList.vue)       |   152 | Общий     | Общие add/remove/normalize/validate для списков строк.                                 |
| [UiVirtualList.vue](../src/common/ui/UiVirtualList.vue)     |   112 | Общий     | Общая виртуализация с сохранением сфокусированной строки.                              |

### `src/modules/agent/ui`

| Компонент                                                      | Строк | Результат | Что проверено                                                                     |
| -------------------------------------------------------------- | ----: | --------- | --------------------------------------------------------------------------------- |
| [AgentActivity.vue](../src/modules/agent/ui/AgentActivity.vue) |   261 | Общий     | Общий рендер tools; парсинг результатов доменный.                                 |
| [AgentChat.vue](../src/modules/agent/ui/AgentChat.vue)         |   315 | R10       | Clipboard повторяется; scroll pin и copied-id относятся к чату.                   |
| [AgentComposer.vue](../src/modules/agent/ui/AgentComposer.vue) |   277 | Локальный | Textarea autosize/IME submit; большого второго composer нет.                      |
| [AgentDock.vue](../src/modules/agent/ui/AgentDock.vue)         |    82 | R9        | Только экспорт, внутренних потребителей нет; отдельный старый рендер turns/tools. |
| [AgentMessage.vue](../src/modules/agent/ui/AgentMessage.vue)   |   145 | Общий     | Лёгкий chat Markdown через renderChatMarkdown; не редактор документов.            |
| [AgentTurn.vue](../src/modules/agent/ui/AgentTurn.vue)         |   178 | Общий     | Переиспользует AgentActivity/AgentMessage.                                        |
| [AgentWelcome.vue](../src/modules/agent/ui/AgentWelcome.vue)   |   166 | Локальный | Data-driven suggestions; не тот же UI, что меню терминалов.                       |

### `src/modules/agents-integration/_`

| Компонент                                                            | Строк | Результат | Что проверено                                       |
| -------------------------------------------------------------------- | ----: | --------- | --------------------------------------------------- |
| [UsageMeter.vue](../src/modules/agents-integration/_/UsageMeter.vue) |   122 | Общий     | Шкала уже общая; проблема R1 в оболочке вокруг неё. |

### `src/modules/agents-integration/claude/ui`

| Компонент                                                                                        | Строк | Результат | Что проверено                                    |
| ------------------------------------------------------------------------------------------------ | ----: | --------- | ------------------------------------------------ |
| [ClaudeUsageIndicator.vue](../src/modules/agents-integration/claude/ui/ClaudeUsageIndicator.vue) |   211 | R1        | Повтор модели окон, tooltip, CSS и переключения. |

### `src/modules/agents-integration/codex/ui`

| Компонент                                                                                     | Строк | Результат | Что проверено                                          |
| --------------------------------------------------------------------------------------------- | ----: | --------- | ------------------------------------------------------ |
| [CodexUsageIndicator.vue](../src/modules/agents-integration/codex/ui/CodexUsageIndicator.vue) |   135 | R1        | Повтор оболочки/tooltip, но одно непереключаемое окно. |

### `src/modules/agents-integration/cursor/ui`

| Компонент                                                                                        | Строк | Результат | Что проверено                                    |
| ------------------------------------------------------------------------------------------------ | ----: | --------- | ------------------------------------------------ |
| [CursorUsageIndicator.vue](../src/modules/agents-integration/cursor/ui/CursorUsageIndicator.vue) |   198 | R1        | Повтор модели окон, tooltip, CSS и переключения. |

### `src/modules/agents-integration/opencode/ui`

| Компонент                                                                                              | Строк | Результат | Что проверено                                    |
| ------------------------------------------------------------------------------------------------------ | ----: | --------- | ------------------------------------------------ |
| [OpenCodeUsageIndicator.vue](../src/modules/agents-integration/opencode/ui/OpenCodeUsageIndicator.vue) |   207 | R1        | Повтор модели окон, tooltip, CSS и переключения. |

### `src/modules/agents-integration/status-bar`

| Компонент                                                                                         | Строк | Результат | Что проверено                                                       |
| ------------------------------------------------------------------------------------------------- | ----: | --------- | ------------------------------------------------------------------- |
| [AgentUsageIndicators.vue](../src/modules/agents-integration/status-bar/AgentUsageIndicators.vue) |    13 | Общий     | Сборка адаптеров через публичные entries; не самостоятельный дубль. |

### `src/modules/app-settings`

| Компонент                                                          | Строк | Результат | Что проверено                                      |
| ------------------------------------------------------------------ | ----: | --------- | -------------------------------------------------- |
| [SettingsPanel.vue](../src/modules/app-settings/SettingsPanel.vue) |    21 | Общий     | Адаптер общего SettingsWorkbench для app settings. |

### `src/modules/catalog/ui`

| Компонент                                                                    | Строк | Результат | Что проверено                                                                       |
| ---------------------------------------------------------------------------- | ----: | --------- | ----------------------------------------------------------------------------------- |
| [MobileProjectPicker.vue](../src/modules/catalog/ui/MobileProjectPicker.vue) |   233 | Локальный | Общий PathBar; mobile overlay и local choices отличаются от ProjectSwitcher search. |
| [PathBar.vue](../src/modules/catalog/ui/PathBar.vue)                         |   444 | Общий     | Путь/автодополнение уже общие desktop/mobile; useDirectoryListing вынесен.          |
| [PathDropdown.vue](../src/modules/catalog/ui/PathDropdown.vue)               |   134 | Общий     | Отдельное представление listing для PathBar.                                        |
| [ProjectForm.vue](../src/modules/catalog/ui/ProjectForm.vue)                 |   216 | R9        | Не используется внутри; повтор новой формы и операций scenarios.                    |
| [ProjectMissing.vue](../src/modules/catalog/ui/ProjectMissing.vue)           |   173 | Локальный | Восстановление/relocate директории; не CRUD настроек проекта.                       |
| [ProjectSettings.vue](../src/modules/catalog/ui/ProjectSettings.vue)         |   124 | Общий     | SettingsWorkbench и provide модели для секций уже переиспользуются.                 |
| [ProjectSwitcher.vue](../src/modules/catalog/ui/ProjectSwitcher.vue)         |   350 | R3/R11    | Каркас острова и адаптер launcher lifecycle; поисковую модель не дублирует.         |

### `src/modules/catalog/ui/settings`

| Компонент                                                                                     | Строк | Результат | Что проверено                                                           |
| --------------------------------------------------------------------------------------------- | ----: | --------- | ----------------------------------------------------------------------- |
| [ProjectGeneralSection.vue](../src/modules/catalog/ui/settings/ProjectGeneralSection.vue)     |    44 | R8        | Повтор поля/fieldset CSS.                                               |
| [ProjectLaunchSection.vue](../src/modules/catalog/ui/settings/ProjectLaunchSection.vue)       |    65 | R8        | Повтор поля/fieldset CSS.                                               |
| [ProjectRemoveSection.vue](../src/modules/catalog/ui/settings/ProjectRemoveSection.vue)       |    26 | Локальный | Доменное подтверждение удаления; общий form model/UiButton/UiHint.      |
| [ProjectScenariosSection.vue](../src/modules/catalog/ui/settings/ProjectScenariosSection.vue) |   159 | R8/R9     | Повтор field layout; старый ProjectForm повторяет операции этой модели. |

### `src/modules/devcontainer`

| Компонент                                                                  | Строк | Результат | Что проверено                                                     |
| -------------------------------------------------------------------------- | ----: | --------- | ----------------------------------------------------------------- |
| [DevcontainerTrust.vue](../src/modules/devcontainer/DevcontainerTrust.vue) |   134 | Общий     | UiDialog/UiDialogActions уже общие; risk list и trust специфичны. |

### `src/modules/dock/ui`

| Компонент                                                     | Строк | Результат | Что проверено                                                              |
| ------------------------------------------------------------- | ----: | --------- | -------------------------------------------------------------------------- |
| [DockGroupView.vue](../src/modules/dock/ui/DockGroupView.vue) |   291 | Общий     | DockTabs/DockSlot уже общие с MobileDock; desktop DnD иной.                |
| [DockTabs.vue](../src/modules/dock/ui/DockTabs.vue)           |   455 | Общий     | Общие табы, rename/context/DnD и registerTabCommands.                      |
| [DockTree.vue](../src/modules/dock/ui/DockTree.vue)           |   201 | R7        | Повтор pointer resize lifecycle; split geometry доменная.                  |
| [DockView.vue](../src/modules/dock/ui/DockView.vue)           |    98 | Общий     | Общий dock context/slots; переключает desktop/mobile.                      |
| [MobileDock.vue](../src/modules/dock/ui/MobileDock.vue)       |   185 | Общий     | Переиспользует DockTabs/DockSlot; поверхности и порядок mobile специфичны. |

### `src/modules/docker/ui`

| Компонент                                                         | Строк | Результат | Что проверено                                                             |
| ----------------------------------------------------------------- | ----: | --------- | ------------------------------------------------------------------------- |
| [DockerBinding.vue](../src/modules/docker/ui/DockerBinding.vue)   |   192 | Общий     | Выделенная Compose-форма, общие UiField и команды.                        |
| [DockerPanel.vue](../src/modules/docker/ui/DockerPanel.vue)       |   316 | R6        | Общая Docker модель; повтор небольших status/name presentation с sidebar. |
| [DockerSettings.vue](../src/modules/docker/ui/DockerSettings.vue) |   151 | Локальный | Глобальные enabled/context, отдельные от project-bound Docker model.      |
| [DockerSidebar.vue](../src/modules/docker/ui/DockerSidebar.vue)   |   101 | R6        | Повтор фильтра project containers из модели.                              |

### `src/modules/file-icons`

| Компонент                                              | Строк | Результат | Что проверено                                                  |
| ------------------------------------------------------ | ----: | --------- | -------------------------------------------------------------- |
| [FileIcon.vue](../src/modules/file-icons/FileIcon.vue) |    58 | Общий     | Общий рендер ResolvedFileIcon; используются дерево/Git/commit. |

### `src/modules/github`

| Компонент                                                          | Строк | Результат | Что проверено                                                     |
| ------------------------------------------------------------------ | ----: | --------- | ----------------------------------------------------------------- |
| [GithubClone.vue](../src/modules/github/GithubClone.vue)           |   349 | Локальный | Clone jobs/Docker options; не повтор GitLab form целиком.         |
| [GithubConnection.vue](../src/modules/github/GithubConnection.vue) |   107 | R5        | Второй GitHub token connect flow.                                 |
| [GithubSettings.vue](../src/modules/github/GithubSettings.vue)     |   310 | R5        | Повтор общей integration формы/операций; OAuth оставить локально. |

### `src/modules/github-workspace`

| Компонент                                                                  | Строк | Результат | Что проверено                                                                   |
| -------------------------------------------------------------------------- | ----: | --------- | ------------------------------------------------------------------------------- |
| [GithubWorkspace.vue](../src/modules/github-workspace/GithubWorkspace.vue) |   178 | Общий     | Общий ProjectWorkspace/профиль; уникальная connection/repository orchestration. |

### `src/modules/github-workspace/ui`

| Компонент                                                                                           | Строк | Результат    | Что проверено                                                             |
| --------------------------------------------------------------------------------------------------- | ----: | ------------ | ------------------------------------------------------------------------- |
| [GithubRepositoryInfo.vue](../src/modules/github-workspace/ui/GithubRepositoryInfo.vue)             |   270 | Общий        | Представление metadata для remote и local repository tab.                 |
| [GithubRepositoryInfoLoader.vue](../src/modules/github-workspace/ui/GithubRepositoryInfoLoader.vue) |    48 | R4, вторично | Общий info UI; loader похож, но имеет repository/gitRef и свою валидацию. |

### `src/modules/gitlab`

| Компонент                                                      | Строк | Результат | Что проверено                                                   |
| -------------------------------------------------------------- | ----: | --------- | --------------------------------------------------------------- |
| [GitlabSettings.vue](../src/modules/gitlab/GitlabSettings.vue) |   277 | R5        | Повтор общей integration формы/операций; URL/import специфичны. |

### `src/modules/ide/ui`

| Компонент                                                            | Строк | Результат | Что проверено                                                         |
| -------------------------------------------------------------------- | ----: | --------- | --------------------------------------------------------------------- |
| [CommandPalette.vue](../src/modules/ide/ui/CommandPalette.vue)       |   251 | Общий     | UiDialog/UiKbd/UiEmpty; поиск команд отличается от launcher search.   |
| [KeybindingsEditor.vue](../src/modules/ide/ui/KeybindingsEditor.vue) |   331 | Общий     | Редактирование выделено от KeybindingsTable; native dialog уже общий. |
| [KeybindingsTable.vue](../src/modules/ide/ui/KeybindingsTable.vue)   |   230 | Общий     | UiVirtualList/UiButton/UiKbd и локальная семантика таблицы.           |

### `src/modules/integration-api`

| Компонент                                                         | Строк | Результат | Что проверено                                                    |
| ----------------------------------------------------------------- | ----: | --------- | ---------------------------------------------------------------- |
| [TokenReveal.vue](../src/modules/integration-api/TokenReveal.vue) |    69 | Общий     | Reveal/hide токена общий GitHub/GitLab, включая timeout/cleanup. |

### `src/modules/launcher`

| Компонент                                                              | Строк | Результат | Что проверено                                                           |
| ---------------------------------------------------------------------- | ----: | --------- | ----------------------------------------------------------------------- |
| [InterfaceSettings.vue](../src/modules/launcher/InterfaceSettings.vue) |   208 | Локальный | Похожая CRUD-обвязка с другими settings, но не общий доменный flow.     |
| [LaunchDetailPanel.vue](../src/modules/launcher/LaunchDetailPanel.vue) |   151 | Общий     | Уже вынесенная web-карточка действий; keyboard policy у владельца, R11. |

### `src/modules/network`

| Компонент                                                         | Строк | Результат | Что проверено                                             |
| ----------------------------------------------------------------- | ----: | --------- | --------------------------------------------------------- |
| [LanInfoPanel.vue](../src/modules/network/LanInfoPanel.vue)       |   237 | R2/R10    | Повтор network API/restart/password и clipboard feedback. |
| [NetworkSettings.vue](../src/modules/network/NetworkSettings.vue) |   215 | R2        | Повтор network API/restart/password.                      |

### `src/modules/provider/ui`

| Компонент                                                         | Строк | Результат | Что проверено                                                       |
| ----------------------------------------------------------------- | ----: | --------- | ------------------------------------------------------------------- |
| [ProviderPanel.vue](../src/modules/provider/ui/ProviderPanel.vue) |   209 | Общий     | Общая useProviders модель и UiField; не token integration provider. |

### `src/modules/runner/ui`

| Компонент                                           | Строк | Результат | Что проверено                                                       |
| --------------------------------------------------- | ----: | --------- | ------------------------------------------------------------------- |
| [RunMenu.vue](../src/modules/runner/ui/RunMenu.vue) |   431 | R3        | Повтор острова/фокуса/позиционирования с LayoutMenu/NewSessionMenu. |

### `src/modules/settings`

| Компонент                                                              | Строк | Результат | Что проверено                                              |
| ---------------------------------------------------------------------- | ----: | --------- | ---------------------------------------------------------- |
| [SettingsWorkbench.vue](../src/modules/settings/SettingsWorkbench.vue) |   501 | Общий     | Общий каркас app/project settings, поиск/sections/visited. |

### `src/modules/terminal/ui`

| Компонент                                                                     | Строк | Результат | Что проверено                                                           |
| ----------------------------------------------------------------------------- | ----: | --------- | ----------------------------------------------------------------------- |
| [TerminalCloseDialog.vue](../src/modules/terminal/ui/TerminalCloseDialog.vue) |    81 | Общий     | Общий UiDialog; содержимое о процессе специфично.                       |
| [TerminalView.vue](../src/modules/terminal/ui/TerminalView.vue)               |   451 | Локальный | Одна реализация xterm; input/links/drop уже вынесены, clipboard особый. |

### `src/modules/workspace/modules/git/ui`

| Компонент                                                                        | Строк | Результат | Что проверено                                                                       |
| -------------------------------------------------------------------------------- | ----: | --------- | ----------------------------------------------------------------------------------- |
| [GitBranchBar.vue](../src/modules/workspace/modules/git/ui/GitBranchBar.vue)     |   318 | Низкий    | Общие EntryDialog/ContextMenu; часы setInterval повторяют GitHistory, можно useNow. |
| [GitChangesTree.vue](../src/modules/workspace/modules/git/ui/GitChangesTree.vue) |   262 | Общий     | Переиспользуется changes и commit row; отличается от файлового дерева.              |
| [GitCommitRow.vue](../src/modules/workspace/modules/git/ui/GitCommitRow.vue)     |   300 | Общий     | GitGraphCell/GitChangesTree и commit-format уже общие.                              |
| [GitGraphCell.vue](../src/modules/workspace/modules/git/ui/GitGraphCell.vue)     |    83 | Общий     | Один SVG рендер графа; числа gutter повторяют row, маленький кандидат.              |
| [GitHistory.vue](../src/modules/workspace/modules/git/ui/GitHistory.vue)         |   360 | Низкий    | Общие GitCommitRow/ContextMenu/copyWithNotice; clock повторяет GitBranchBar.        |
| [GitPanel.vue](../src/modules/workspace/modules/git/ui/GitPanel.vue)             |   339 | Общий     | Композиция branch/tree/history и change commands; не копия workspace.               |
| [GitSplitter.vue](../src/modules/workspace/modules/git/ui/GitSplitter.vue)       |   107 | R7        | Повтор pointer lifecycle; resizeHistory уже выделен.                                |

### `src/modules/workspace/modules/issues/ui`

| Компонент                                                                               | Строк | Результат | Что проверено                                                   |
| --------------------------------------------------------------------------------------- | ----: | --------- | --------------------------------------------------------------- |
| [DiscussionsPanel.vue](../src/modules/workspace/modules/issues/ui/DiscussionsPanel.vue) |   116 | Общий     | usePagedList/useTrackerPanel/TrackerPanel/TrackerRow уже общие. |
| [IssuesPanel.vue](../src/modules/workspace/modules/issues/ui/IssuesPanel.vue)           |    78 | Общий     | Общая tracker infrastructure; тонкий issue adapter.             |
| [PullsPanel.vue](../src/modules/workspace/modules/issues/ui/PullsPanel.vue)             |   112 | Общий     | Общая tracker infrastructure; PR state icons специфичны.        |
| [TrackerPanel.vue](../src/modules/workspace/modules/issues/ui/TrackerPanel.vue)         |   167 | Общий     | Общий заголовок/filter/loading/more для трёх trackers.          |
| [TrackerRow.vue](../src/modules/workspace/modules/issues/ui/TrackerRow.vue)             |    82 | Общий     | Общая строка title/labels/author и слоты.                       |

### `src/modules/workspace/modules/tree/ui`

| Компонент                                                                                     | Строк | Результат | Что проверено                                                              |
| --------------------------------------------------------------------------------------------- | ----: | --------- | -------------------------------------------------------------------------- |
| [FileTree.vue](../src/modules/workspace/modules/tree/ui/FileTree.vue)                         |   424 | Общий     | Рекурсивное дерево; paging/selection/operations/keyboard/DnD уже вынесены. |
| [FilesExcludeSettings.vue](../src/modules/workspace/modules/tree/ui/FilesExcludeSettings.vue) |   140 | Общий     | UiStringList переиспользуется; optimistic rollback доменный.               |

### `src/modules/workspace/modules/viewers/ui`

| Компонент                                                                                        | Строк | Результат    | Что проверено                                                                 |
| ------------------------------------------------------------------------------------------------ | ----: | ------------ | ----------------------------------------------------------------------------- |
| [ArchiveViewer.vue](../src/modules/workspace/modules/viewers/ui/ArchiveViewer.vue)               |   157 | Локальный    | Архивная таблица; bytes/date — небольшие formatters, крупного дубля нет.      |
| [CodeViewer.vue](../src/modules/workspace/modules/viewers/ui/CodeViewer.vue)                     |   433 | Общий        | Один CodeMirror для файлов/source/preview/diff; extensions выделены частично. |
| [CommitFileDiff.vue](../src/modules/workspace/modules/viewers/ui/CommitFileDiff.vue)             |   162 | R7           | Повтор drag lifecycle; CodeViewer уже общий.                                  |
| [CommitFiles.vue](../src/modules/workspace/modules/viewers/ui/CommitFiles.vue)                   |   256 | Общий        | Общие FileIcon/CommitFileDiff; forwarding/reset и список файлов специфичны.   |
| [CommitMeta.vue](../src/modules/workspace/modules/viewers/ui/CommitMeta.vue)                     |   144 | Общий        | commit-format и copyWithNotice уже общие.                                     |
| [CommitOverview.vue](../src/modules/workspace/modules/viewers/ui/CommitOverview.vue)             |   122 | R4, вторично | Loader lifecycle похож, но reset diffs/subject специфичны.                    |
| [DiscussionView.vue](../src/modules/workspace/modules/viewers/ui/DiscussionView.vue)             |   116 | R4           | Повтор loader; общие TrackerDetail/Comments, flatten replies специфичен.      |
| [EditorSettings.vue](../src/modules/workspace/modules/viewers/ui/EditorSettings.vue)             |   122 | Общий        | CodeViewer preview/editor-theme переиспользуются; save+rollback доменные.     |
| [HtmlViewer.vue](../src/modules/workspace/modules/viewers/ui/HtmlViewer.vue)                     |   150 | Общий        | SplitPanes/CodeViewer уже общие; iframe и viewport controls специфичны.       |
| [ImageViewport.vue](../src/modules/workspace/modules/viewers/ui/ImageViewport.vue)               |   341 | Общий        | Общий raster/SVG zoom/pan; не тот же drag, что разделители.                   |
| [IssueView.vue](../src/modules/workspace/modules/viewers/ui/IssueView.vue)                       |    80 | R4           | Повтор loader; общий tracker UI.                                              |
| [MarkdownViewer.vue](../src/modules/workspace/modules/viewers/ui/MarkdownViewer.vue)             |    87 | Общий        | CodeViewer/VisualMarkdownEditor; fallback и blur-save относятся к wrapper.    |
| [PullRequestView.vue](../src/modules/workspace/modules/viewers/ui/PullRequestView.vue)           |   212 | R4           | Повтор loader; общий tracker UI, PR files/reviews специфичны.                 |
| [SplitPanes.vue](../src/modules/workspace/modules/viewers/ui/SplitPanes.vue)                     |   171 | R7           | UI уже общий HTML/SVG; pointer lifecycle повторяет остальные разделители.     |
| [SvgViewer.vue](../src/modules/workspace/modules/viewers/ui/SvgViewer.vue)                       |   204 | Общий        | SplitPanes/ImageViewport/CodeViewer; параметры SVG специфичны.                |
| [TrackerComments.vue](../src/modules/workspace/modules/viewers/ui/TrackerComments.vue)           |   107 | Общий        | Общие комментарии/reviews/replies; UiAvatar/Markdown/Reactions.               |
| [TrackerDetail.vue](../src/modules/workspace/modules/viewers/ui/TrackerDetail.vue)               |   190 | Общий        | Общий каркас issue/pull/discussion, метаданные/Markdown/слоты.                |
| [TrackerReactions.vue](../src/modules/workspace/modules/viewers/ui/TrackerReactions.vue)         |    53 | Общий        | Общие reactions и каталог emoji.                                              |
| [VisualMarkdownEditor.vue](../src/modules/workspace/modules/viewers/ui/VisualMarkdownEditor.vue) |   424 | Общий        | Один Milkdown renderer/editor; document и tracker compact reuse.              |

### `src/modules/workspace/ui`

| Компонент                                                                | Строк | Результат     | Что проверено                                                                   |
| ------------------------------------------------------------------------ | ----: | ------------- | ------------------------------------------------------------------------------- |
| [FilePanel.vue](../src/modules/workspace/ui/FilePanel.vue)               |   153 | Общий         | Выбирает общий viewer; forwarding props/events не большой дубль.                |
| [FilesSection.vue](../src/modules/workspace/ui/FilesSection.vue)         |    16 | Общий         | Тонкий адаптер FileTree к sidebar registry.                                     |
| [LayoutMenu.vue](../src/modules/workspace/ui/LayoutMenu.vue)             |   329 | R3            | Повтор острова/фокуса/позиционирования.                                         |
| [MobileSurfaces.vue](../src/modules/workspace/ui/MobileSurfaces.vue)     |    82 | Локальный     | Небольшая data-driven навигация mobile, отличается от SidebarTabs.              |
| [NewSessionMenu.vue](../src/modules/workspace/ui/NewSessionMenu.vue)     |   283 | R3            | Повтор острова/фокуса/позиционирования.                                         |
| [PanelHost.vue](../src/modules/workspace/ui/PanelHost.vue)               |    23 | Общий         | Общий хост keepAlive Teleport; сохранять DOM identity.                          |
| [ProjectWorkspace.vue](../src/modules/workspace/ui/ProjectWorkspace.vue) |   490 | R7, через lib | Общая orchestration remote/local; sidebar-resize повторяет drag infrastructure. |
| [SearchPanel.vue](../src/modules/workspace/ui/SearchPanel.vue)           |   346 | Локальный     | Workspace search с abort/debounce/snippets; не launcher/command search.         |
| [SidebarTabs.vue](../src/modules/workspace/ui/SidebarTabs.vue)           |   194 | Общий         | Общая горизонтальная/вертикальная навигация sidebar.                            |
| [StatusBar.vue](../src/modules/workspace/ui/StatusBar.vue)               |    77 | Общий         | Общие editor-status и AgentUsageIndicators.                                     |
| [WorkbenchDock.vue](../src/modules/workspace/ui/WorkbenchDock.vue)       |   196 | Общий         | DockView/FilePanel/TerminalView/PanelHost; стабильное keepAlive.                |
| [WorkbenchToolbar.vue](../src/modules/workspace/ui/WorkbenchToolbar.vue) |    80 | Общий         | Композиция LayoutMenu и слота запуска.                                          |
| [WorkspaceSidebar.vue](../src/modules/workspace/ui/WorkspaceSidebar.vue) |   238 | Общий         | Sidebar registry/views и SidebarTabs; панели используют общие contracts.        |

### `src/pages/gh/projects`

| Компонент                                                           | Строк | Результат | Что проверено                         |
| ------------------------------------------------------------------- | ----: | --------- | ------------------------------------- |
| [[...githubPath].vue](../src/pages/gh/projects/[...githubPath].vue) |    13 | Общий     | Тонкий route adapter GithubWorkspace. |

### `src/pages`

| Компонент                           | Строк | Результат | Что проверено                                                  |
| ----------------------------------- | ----: | --------- | -------------------------------------------------------------- |
| [index.vue](../src/pages/index.vue) |   444 | R11       | Web launcher общей model; повтор detail/favorite policy с GTK. |

### `src/pages/projects`

| Компонент                                                          | Строк | Результат | Что проверено                                               |
| ------------------------------------------------------------------ | ----: | --------- | ----------------------------------------------------------- |
| [[...projectPath].vue](../src/pages/projects/[...projectPath].vue) |   204 | Общий     | Общий ProjectWorkspace; local project/profile/restore glue. |

### `src/pages`

| Компонент                                 | Строк | Результат | Что проверено                       |
| ----------------------------------------- | ----: | --------- | ----------------------------------- |
| [settings.vue](../src/pages/settings.vue) |    16 | Общий     | Тонкий route adapter SettingsPanel. |
