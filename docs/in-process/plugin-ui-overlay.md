# Overlay и хуки чата для плагинов

## Сейчас

**Browser-runtime.** `activate(api)` живёт в `packages/client/modules/plugin-runtime/runtime.ts` (`activate`, `identityOf`, `eligible`, `reconcile`), ESM грузится через `import(/* @vite-ignore */ url)` с device-aware пути. `createApi` (`plugin-runtime/api.ts`) отдаёт `apiVersion`, `packageName`, `packageVersion`, `device`, `signal`, `assetUrl`, `onDispose` и реестры `languages`, `panels`, `tabs`, `commands`, `agents`. Версия контракта — `PLUGIN_API_VERSION = 1` в `packages/plugin-api/modules/api/index.ts`; при несовпадении runtime бросает «Плагин собран для другой версии API».

**`mount(container, context)`.** Тип — `PanelRegistration`/`TabRegistration` (`plugin-api/modules/api/index.ts`), вызов — `PluginMount.vue` → `mountContribution` (`plugin-runtime/store.ts`, `runMount`). `context` содержит ровно `projectId`, `device`, `signal`, `params`, `assetUrl`, `commands.run(ide.*)`, `workspace.openFile`, `workspace.openTab`. Ни настроек, ни уведомлений, ни хранилища, ни данных чата в `context` нет. Для панели `params` всегда `{}`; `params` осмысленны только у вкладки.

**Точки монтирования.** Манифест (`packages/core/modules/plugins/browser.ts`, `PluginPanelContribution`) знает только `placement: "sidebar" | "aside"`; `assertAllowedKeys` отклоняет любое новое поле, лимит — `maxContributions = 50` на категорию. `plugin-workspace.ts` (`sectionOf`, `usePluginWorkspaceViews`) превращает `aside` в служебную группу левой полосы, `tab-views.ts` регистрирует вкладки. Overlay, per-message и per-region слотов нет.

**Жизненный цикл.** `PluginMount.vue` пересоздаёт mount по `watch([instance, plugin, contributionId, projectId, params])`, `onBeforeUnmount(stop)` абортит `signal` и зовёт disposer. Скрытие панели не размонтирует (v-show), закрытие/disable — размонтирует. `runtime.ts#deactivate` → `scope.dispose()` (`scope.ts`), HMR — `app/entry.ts`, `import.meta.hot.dispose(disposePluginRuntime)`.

**Чат.** `agent/ui/AgentChat.vue` рендерит `.chat-log` (v-show) → `.conversation role="log" aria-live="polite"` → `AgentTurn v-for="turn in shown" :key="turn.id"`. `agent-turns/ui/AgentTurn.vue` — `<article class="turn" :class="[turn.role]">`, ветки `.user-row`/`.user-message` и `.assistant-body`; текст ответа идёт через `AgentMessage` по каждому текстовому сегменту, поэтому на один turn бывает несколько `.agent-message`. `AgentMessage.vue` (`splitMessage`) чередует `AgentMarkdown` и `AgentWidget`; `AgentMarkdown.vue` — `.md` с `v-html` по блокам `.md-block { display: contents }`.

**DOM-контрактов сообщения нет.** Grep по `data-*` даёт только `data-chat-file` (`agent-turns/lib/markdown.ts`), `data-chip` (`AgentTurn.vue`), а также общие `data-command`, `data-surface`, `data-swipe-ignore`. Ни `data-turn-id`, ни `data-chat-key`, ни `data-part-*`. Классы `.turn`, `.agent-message`, `.md`, `.chat-log` используются тестами (`packages/client/tests/zen-mode-browser.test.mjs`, `agent-widgets-browser.test.mjs`), но публичным контрактом не объявлены.

**Виртуализации нет.** `agent/model/chat-window.ts`: `PAGE = 5`, `PRELOAD_PX = 400`, `shown` — срез `turns`, `hidden` — счётчик; старые сообщения **добавляются** при прокрутке к верху и больше не размонтируются. `useChatScroll` держит позицию и `ResizeObserver`. Смена чата меняет `turns[0].id`, `visible` сбрасывается в 5, ключи `turn.id` другие → полный remount. Тот же `AgentTurn` используется в `AgentTaskView.vue` и `agent/modules/jobs/ui/AgentJobTab.vue`.

**Данные для плагина.** Публичные IDE-команды: `ide.agent.chats.list`, `ide.agent.turns.list` (текст обрезан до 200 символов), `ide.agent.chat.status` (`AgentChatStatus.lastAssistantText`), `ide.agent.side.ask` (`agent/model/agent-commands.ts`, `side-commands.ts`). Событий «сообщение появилось» нет: `projector:agent` (`agent-core/api/event-stream.ts`) привязан к `stream` конкретного запуска, `/api/events` (`runner/lib/event-names.ts`) даёт `jobs-changed`, `runs-changed`, но не текст сообщений. `window.fetch = authedFetch` (`app/entry.ts`), поэтому `fetch("/api/…")` из плагина работает и на LAN, но остаётся polling.

**UI-кит.** `UiTooltip` (`common/ui/UiTooltip.vue`) — Vue-компонент: `span.tooltip-anchor`, `mouseenter` (200 мс) / `focusin` (0), `UiPopupSurface` с `popover="manual"`, `role="tooltip"`, CSS anchor positioning, `describedby` через slot. Отдельного vanilla-хелпера нет, `plugin-api` не содержит runtime-кода, кроме `definePlugin`. Глобального overlay-слоя тоже нет: `UiNoticeHost`, `UiIsland`, `ContextMenu`, `ImageModal` телепортируют каждый свой слой в `body`; общие слои — только `--z-sticky: 10`, `--z-expanded: 30`, `--z-popover: 100` в `app/styles.css`. Shadow DOM не используется (`attachShadow` — 0 вхождений).

## Чего не хватает

- Нет `shell.overlay`/глобального слоя, куда плагин мог бы смонтировать DOM без правки layout.
- Нет ни одного стабильного `data-*` на turn/сообщении/markdown-блоке, поэтому glossary и маскот цепляются за `.turn`, `.md`, `.agent-message`.
- Нет подписки на монтирование/обновление сообщения: только polling `ide.agent.turns.list` с обрезкой текста.
- Нет способа отдать плагину общий тултип; при этом host-токены и popover-top-layer плагину доступны.
- `AgentMessage` не получает индекс части, поэтому слот текста нечем стабильно ключевать (в `AgentTurn` есть только `segments.key` вида `t{index}`).
- Нет версионируемой декларации возможностей («есть слот X»), только жёсткая проверка `apiVersion`.

## Варианты

### A. Декларативные слоты `shell.overlay` + `chat.message.actions`/`chat.message.text`

Манифест: новый `placement` или `contributes.overlays` в `core/modules/plugins/browser.ts` (+ `validatePanelContribution` и `assertAllowedKeys`); `PluginApi.overlays.register` в `plugin-api` и `plugin-runtime/api.ts`; host-компонент слоя в `app/App.vue`/`AppShell.vue`; слот действий — в `AgentTurn.vue` (рядом с `.turn-footer`), слот текста — в `AgentMessage.vue`/`AgentMarkdown.vue`; пропсы `{ turnId, role, at, text, streaming, projectId }`.

- **Плюсы:** контракт явный и версионируемый, Vue сам владеет mount/unmount, не нужно угадывать классы.
- **Минусы:** `AgentMarkdown` рендерит `v-html`, слот внутри `.md-block` будет стёрт при следующем рендере блока; слот текста возможен только рядом с блоком. Один turn = несколько `.agent-message`, нужен стабильный ключ части. `shell.overlay` сам решает pointer-events и z-index.
- **Производительность:** O(смонтированных turn); до прокрутки к верху их ~5–10, после — все, то есть 200 контейнеров и 200 disposer'ов на длинном чате.
- **Доступность / безопасность:** слот действий даёт host-кнопку, но подсказку плагин рисует сам; snapshot вместо живого reactive `AgentTurn`, иначе утекают `injected`, `run`, `tail`, `worktree`.
- **Оценка:** 7–10 дней.

### B. API-хуки + стабильные `data-*`

Добавить атрибуты в `AgentChat.vue`/`AgentTurn.vue`/`AgentMessage.vue`/`AgentMarkdown.vue` и `PluginApi.chat.onMessageMount(cb)`/`onMessageUpdate(cb)`/`getMessages()` в `plugin-runtime`, вызываемый из `AgentTurn` по `onMounted`/`watch`.

- **Плюсы:** дешевле всего, не меняет разметку и layout, работает и для `.md`, и для действий; плагин сам рисует overlay в своём контейнере (панель уже есть) или в `body`.
- **Минусы:** плагин всё равно позиционирует свой DOM по `getBoundingClientRect` и должен переживать resize/scroll; `AgentMessage` может быть несколько на turn — нужен `data-part`; API нужен только ради событий.
- **Производительность:** один callback на смонтированный turn, без MutationObserver; на 200 turn — 200 вызовов при монтировании, дальше только изменения.
- **Доступность / безопасность:** на плагине, host даёт только якорь; уровень доступа тот же, что сейчас (плагин уже видит DOM), но snapshot можно ограничить.
- **Оценка:** 4–6 дней.

### C. «Рендерер» markdown-расширения

Плагин регистрирует словарь/синтаксис, host вставляет разметку до DOMPurify (`agent-turns/lib/markdown.ts`, `renderChatMarkdown`) или после (`decorateHtml`), с ограничением allowlist тегов/атрибутов.

- **Плюсы:** самый точный результат, термины внутри текста без позиционирования, лучше всего для скринридера и клавиатуры.
- **Минусы:** `markdown-it` — синглтон с глобальными `renderer.rules`; per-plugin правила потребуют отдельного экземпляра или `env`. `createMarkdownStream` перерисовывает открытый блок на каждом чанке и делает `reset()` при несовпадении текста; Answer Doctor заменяет текст turn (`docs/agent-widgets.md`), правки и версии — тоже. DOMPurify и streaming-терпимость резко усложняют контракт.
- **Производительность:** рендер каждого чанка дороже; на длинных ответах и 200 сообщениях — худший вариант.
- **Доступность / безопасность:** лучшая доступность, если host сам ставит `tabindex`/`aria-describedby`; но плагин влияет на HTML всех ответов, нужен жёсткий allowlist.
- **Оценка:** 10–14 дней.

### D. Ничего не давать, MutationObserver

- **Плюсы:** ноль работы в host.
- **Минусы:** наблюдатель на `.chat-log` срабатывает на каждый чанк стриминга (открытый `.md-block` переписывается целиком), на скролл-подгрузку и смену чата; декорации внутри `v-html` затираются; при появлении виртуализации плагин сломается молча; классы `.turn`/`.md` не контракт; несколько плагинов дают несколько наблюдателей на одно дерево.
- **Доступность / безопасность:** целиком на плагине, host не может ни ограничить, ни проверить.
- **Оценка:** 0 в host, 1–2 дня на плагин, но долг переносится на каждый рефакторинг разметки.

## Рекомендация и минимальный первый шаг

Сначала **B**: зафиксировать `data-*` и один событийный хук. Это не ломает разметку, разблокирует glossary и маскота и остаётся полезным при любом следующем варианте. Затем **A только в части `shell.overlay`** — отдельный host-контейнер (top-layer/popover или фиксированный слой с `--z-popover`) без per-message слота. `chat.message.text` отложить: он конфликтует с `v-html` и стримингом, пока нет host-рендерера из C. `chat.message.actions` — следующий шаг после overlay, он дешевле текстового.

Минимальный публичный контракт (зафиксировать в `docs/plugins.md` и типах `plugin-api`):

- `[data-chat-key]` на `.chat-log`/`.conversation` — ключ открытого чата.
- `[data-turn-id]`, `[data-turn-role="user|assistant"]`, `[data-turn-index]` на `article.turn` — во всех трёх хостах (`AgentChat`, `AgentTaskView`, `AgentJobTab`).
- `[data-message-part="text|work|note"]` и `[data-part-key]` на блоках внутри turn.
- `[data-md-block]` на `.md-block`, `[data-streaming="true|false"]` на `.md`.
- `[data-plugin-slot="shell.overlay|chat.message.actions"]` на host-контейнерах слотов.
- `PluginApi.chat.onMessageMount(cb)` → `cb({ turnId, role, at, text, streaming, element, signal })`, `onMessageUnmount`, `onMessagesChange`; snapshot — plain object, без `injected`/`run`/`tail`.

## Риски и проверки

- **Контракт:** новые поля манифеста отклоняются старым host (`assertAllowedKeys`), поэтому пакету нужен `engines.projector`; `apiVersion` остаётся `1` при аддитивных возможностях, но нужен явный `api.capabilities`/`features`, иначе плагин не отличит host со слотом от host без него.
- **Разметка:** `AgentTurn` используется в трёх местах; атрибуты и слоты обязаны работать и в readonly-режиме `AgentTaskView`.
- **Стриминг:** не вставлять DOM внутрь `.md-block`; `createMarkdownStream` заменяет открытый блок на каждом чанке, `reset()` — при смене текста.
- **Виртуализация:** сейчас её нет, но контракт должен быть mount/unmount-ориентированным; состояние плагина — в данных, не в DOM.
- **Доступность:** hover-only не годится; нужен focusable якорь, `aria-describedby`, Escape, тач (popover по tap), `prefers-reduced-motion` для маскота. Образец — `UiTooltip.vue`, но плагин обязан рисовать свой: Vue-компонент ему не отдать.
- **Безопасность:** плагин доверенный, на origin страницы видит DOM и API; overlay не увеличивает права, но snapshot не должен содержать лишних полей. HTML из плагина в чат не пускать.
- **Проверки:** Playwright в проекте нет. Браузерные тесты — собственный CDP-драйвер `tests/fixtures/chromium-driver.mjs` (`createChromium`, `createBrowserFixture`), как в `packages/client/tests/plugin-workspace-browser.test.mjs`: фикстурный плагин, `applyRuntimeCatalog`, `browser.evaluate` по `data-*`, проверка `mounts/cleanups`, disable → DOM пуст, HMR/повторный enable → новый scope. Юнит-уровень — `plugin-mount-lifecycle.test.mjs`, `plugin-runtime-activation.test.mjs`, `plugin-agent-client.test.mjs`; манифест — `plugins.test.mjs` в `packages/server/tests`. Сценарии: смена чата, скролл к верху (подгрузка 5), стриминг, Answer Doctor, readonly-задача, disable во время mount.

## Открытые вопросы

- `shell.overlay`: один слой на окно или на вкладку/чат? Кто владеет `pointer-events`, `z-index` и закрытием по Escape?
- Отдавать ли плагину `element` сообщения (риск мутации) или только `DOMRect`/якорь?
- Нужен ли `chat.message.text` вообще, или glossary достаточно `data-*` + своего overlay?
- Как плагин узнаёт о завершении стриминга: `data-streaming` или отдельное событие?
- Нужны ли плагину настройки/уведомления в `context` (концепт в `docs/in-process/plugin-concept/concept.md` их обещает), и не раздувает ли это `apiVersion`?
- Ограничивать ли число одновременных overlay-узлов и подписок на плагин, и как это диагностировать в настройках?
