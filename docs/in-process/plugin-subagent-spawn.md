# Запуск субагентов из плагина

Проверено по коду и документации на 2026-11-15. Короткий вывод: у серверного API плагина нет
запуска агентов, но браузерный плагин технически может вызывать HTTP заданий; поддержанного
контракта «модель + промпт → результат» нет ни у одного вида плагинов.

## Сейчас

- `PluginCodeApi` (`packages/server/modules/agents/plugin/code.ts:123`) отдаёт только `require`,
  `createAcpBackend`, `acp`, `host`, `features`, `roles`, `widgets`, `mcp` и `providers`. Полей
  `jobs`, `agents`, `runAgent`, `models` или `workflows` в нём нет.
- `api.roles` — `PluginRoleApi.context(role?, cwd?)` (`code.ts:87`): плагин получает текст уже
  готового снимка роли (`packages/server/modules/agent-roles/runtime.ts`, `roleContext`). Списка
  ролей, поиска по id и модели в API нет. `api.features` (`code.ts:81`) — только `enabled()` и
  `prompt()` для возможностей чата.
- `createAcpBackend(program)` (`packages/server/modules/agents/acp/acp-backend.ts:74`) регистрирует
  один ACP-процесс и возвращает `AgentBackend` с `run`, `controls`, `commands`, `sessions`. Это
  бэкенд одного агента для хода чата; он не спавнит субагента, не видит реестр других агентов и не
  создаёт задание. Несколько вызовов дают несколько отдельных агентов, а не иерархию.
- `api.host.runHosted(options, handle, agentId)` (`code.ts:72`) — не одноразовый запуск: ему нужен
  `AgentRunHandle` (`packages/server/modules/agent/backend.ts:70`), который обычно создаёт маршрут
  через `createRun` (`packages/server/modules/agent/run-request.ts:59`). `runHostedAgent`
  (`hosted-run.ts:16`) запускает процесс по уже существующему каталогу хода; запись хода и задание
  он не создаёт.
- `startJob` (`packages/server/modules/agent/jobs.ts:215`) принимает `StartJobInput` (`jobs.ts:51`):
  `backend`, `task`, `projectId`, `cwd`, `worktree`, `origin`, `sessionId`, `role`, `selection`,
  `permissionMode`, `unattended`. Модель — это `selection.model` (и другие controls); отдельного
  поля «модель» нет, произвольного `prompt` у задания нет — только `task` и снимок `role`.
- Маршрут `startFrom` (`packages/server/routes/api/agent-jobs.ts:44`) требует внешнего hosted-агента,
  запрещает встроенный Projector, служебную роль и несовпадение `role.agent` с `backend`; `task`
  до 20 000 символов; `selection` — произвольные строки; `unattended: true` автоматически разрешает
  инструменты и пропускает вопросы; `mode`/`permissionMode` перекрывают режим роли.
- Жизненный цикл: `waitForJob` (до 45 с), `stopJob`, `answerJob`, `removeJob` (`jobs.ts`),
  `followUpJob`/`retryJob`/`forkJob` (`jobs-followup.ts`, `jobs-worktree.ts`), `jobDiff`
  (`jobs-diff.ts:50`), worktree (`worktrees.ts`). `onEvent` (`jobs-live.ts:133`) пишет `text`,
  `tool`, `task`, `permission-request`, `question-request`, но не `usage`; итог — 100 000 символов,
  журнал — 1500 записей, входы/выходы обрезаются до 4000.
- Очереди заданий нет: `queued` — короткое состояние до старта, задания стартуют сразу, потолка
  параллельности и планировщика нет (`docs/agent-jobs.md`). `queue-store.ts` — очередь сообщений
  чата. Токены задания не сохраняются: `usage` нет в `AgentJob` (`jobs-store.ts:45`) и не
  обрабатывается в `onEvent`; аналитика (`usage-history.ts`) читает ходы истории чата. Поля
  бюджета/лимита у задания `не нашёл`.
- Роли: глобальные — `$XDG_DATA_HOME/projector/agent/roles.json`, чтение — `readAgentRole`
  (`packages/server/modules/agent-roles/store.ts:103`); проектные — `.projector/roles.json` с
  доверием по хешу. `AgentRoleSnapshot` (`packages/core/modules/agent-role/index.ts:39`) хранит
  `roleId`, `name`, `selection`, `permissionMode`, `prompt`, `template`, `skills`, `mcp`; `isolate`
  в снимок не входит. Снимок задания лежит в `job.json` (`job.role`) и создаётся `snapshotOfRole`
  в `startFrom` (`agent-jobs.ts:102`); `retry`/`fork` его сохраняют. У чата снимок — в `chats.role`
  (`role-store.ts`). `drive` передаёт `job.role` в `runAgent` (`jobs.ts:109`); внешний агент
  получает `roleContext` (промпт, пути навыков, MCP), Projector собирает промпт в
  `projector-system.ts`. `permissionMode` — режим по умолчанию, а не жёсткие права: роль не меняет
  hooks и `allowed-tools` (`docs/agent-roles.md`).
- Одноразового API «модель + промпт → результат» нет. `POST /api/agent/jobs` — durable-путь только
  для внешних агентов, асинхронный, без произвольного `prompt`. `POST /api/agent`
  (`run-request.ts:33`) — интерактивный SSE-ход любого агента, создаёт run-файл для hosted, но не
  задание и не историю. `POST /api/agent/side` (`routes/api/agent-side.ts:15`) — read-only вопрос
  жёстко на бэкенде `projector`. `task` (`projector-task.ts`) — read-only субагент Projector: роль
  только `projector`, чтение, лимиты `PROJECTOR_TASK_*`, без MCP/навыков/истории; доступен только
  инструменту Projector. `judge`/`lens`/`doctor` (`judge/verdict.ts`, `agent-lens.ts`,
  `form-doctor.ts`) — одноразовые `generateText`/`quietChatModel` с фиксированным промптом, наружу
  не отдаются.
- Виды агентов: встроенный `projector` (свои инструменты и `task`, модели провайдеров) **запрещён**
  в `POST /api/agent/jobs`; внешние ACP (`codex`, `opencode`, `kimi`, плагинный `cursor`) и
  агенты-плагины (`claude-code` или свой `AgentBackend`) разрешены, если объявили
  `capabilities.hosted` и установлены.
- Браузерный плагин исполняется на origin страницы (`docs/plugins.md`) и получает обычный `fetch`.
  `accessAllowed` (`packages/server/modules/access/access.ts`) для POST проверяет Origin, Host и
  loopback; same-origin `fetch('/api/agent/jobs', { method: 'POST' })` проходит. Значит панель или
  вкладка плагина может запускать задания уже сегодня, хотя это не объявленный API плагина.
  `context.commands.run` (`packages/client/modules/plugin-runtime/ui/PluginMount.vue:45`) выполняет
  `ide.agent.job.start`, но клиентская `StartJobOptions`
  (`packages/client/modules/agent-core/api/jobs.ts:101`) не передаёт `selection`, поэтому выбрать
  модель командой нельзя; сырой POST принимает `selection`, `unattended` и `mode`. Серверный плагин
  тоже может сходить на `http://localhost:4177` с Origin, но это обход контракта.

## Чего не хватает

- В `PluginCodeApi` нет `jobs.spawn`, списка агентов/моделей и чтения ролей; серверный плагин не
  может запустить ни задание, ни чужого агента без обхода.
- Нет контракта «модель + промпт + лимит → результат»: `selection` есть только у сырого HTTP, роль
  привязана к одному backend, `prompt` задания не настраивается.
- Нет структурного вердикта: результат задания — свободный текст; схемы, JSON-валидации и retry при
  невалидном JSON нет; `agent-judge` — ручной парсинг, а не общий механизм.
- Нет бюджета и учёта: задания не пишут `usage`, token/cost cap отсутствует; у Claude Code есть
  `budget`/`steps`, у остальных нет; остановить можно только по времени `stopJob`.
- Нет read-only задания: `task` read-only только у Projector; роль не ограничивает инструменты.
- Нет состояния workflow, очереди, зависимостей и артефактов: `plugins/data` зарезервирован, но
  хранилища нет (`docs/plugins.md`); передать можно только текст `task` (20k) и результат (100k).
- Нет жизненного цикла: у серверного плагина нет `onDispose`; выключение во время задания оставляет сироту (`docs/in-process/plugin-agents.md`).
- Нет изоляции прав: доверие плагина — хеш всего пакета, отдельных capabilities нет; плагин с jobs получает и ответы на разрешения, и `unattended`, и чужие проекты.
- `не нашёл` метаданных семейства моделей: controls дают `model`/`effort`/`mode` на агента, но глобального каталога «семейство → модель» нет; `role-team`/workflow в коде тоже `не нашёл`.

## Варианты

| Критерий        | A. `api.jobs.spawn`                                                                                                                                                                         | B. `contributes.workflows`                                                                                                                                                 | C. Оркестратор в ядре                                                                                                                          |
| --------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| Что             | Обёртка над `startJob`/`readJob`/`waitForJob`/`jobDiff`/`stopJob`: id, журнал/события, `result`; плагин только оркестрирует                                                                 | Шаги `{ role \| agent, model, prompt, output: "json", next }`, переходы и условия в манифесте, без кода                                                                    | Команда `ide.agent.team.*` или навык `role-team` на существующих `ide.agent.job.*` и `task`                                                    |
| Плюсы           | Durable jobs, worktree, diff, retry/fork, recovery, «Работы»; минимум нового кода                                                                                                           | Автору не нужен JS; шаги проверяемы; UI может рисовать прогресс; хеш доверия уже есть                                                                                      | Один `projector-guard`; готовые jobs/task/roles/diff; нет нового доверия; навык за 2–4 дня; видно в чате и «Работах»                           |
| Минусы          | Новый контракт; нужен слой прав; нет учёта токенов, бюджет по времени; role-team остаётся в плагине                                                                                         | JSON/условия/повторы быстро превращают декларацию в DSL; нужен движок, состояние, миграции; дублирует jobs; «данные, а не код» ломается                                    | Автор плагина не поставит свой оркестратор; ядро знает шаблон; роли/модели вручную; Projector не job, PLAN у оркестратора                      |
| Файлы           | `agents/plugin/code.ts` (`PluginCodeApi`, `loadCodeAgents`), `plugin-api/index.ts`, `agent/jobs.ts`, `routes/api/agent-jobs.ts` (вынести `startFrom`), `docs/plugins.md`                    | `core/modules/plugins/index.ts:249` (allowlist), валидатор, `server/modules/plugins`, новый `server/modules/plugin-workflows`, `client/modules/plugins` и `plugin-runtime` | `system-skills/agent-jobs/SKILL.md` (образец), `job-commands.ts`, `projector-task.ts`, `agent-roles`; движок — `agent/jobs.ts` + новый модуль  |
| Токены/деньги   | Оценка: 4 сессии — plan/reviewer 5–20k, worker 20–200k; цена зависит от модели; job usage нет; у Claude Code `budget`/`steps`, у остальных нет                                              | Те же 4+ сессии; учёт всё равно надо добавлять в jobs                                                                                                                      | Те же сессии; `task` пишет `recordTaskSpend`, jobs — нет; общий бюджет команды надо добавлять                                                  |
| Безопасность    | Плагин уже с Node/правами страницы; обязательны явный `projectId`, allowlist backend, запрет `unattended`/`bypassPermissions`/`answer(allow)`/`origin`/`merge`, лимит параллельности, аудит | Workflow с промптами — исполняемое поведение; trust обязателен; запрет `unattended`, лимиты, подтверждение первого запуска; без этого худший риск                          | Лучший: изменения подтверждает guard, `task` read-only, чужих секретов нет; остаются prompt injection из результатов и доверие к ролям проекта |
| Отмена/таймауты | `stopJob` + свой дедлайн; `wait` 45 с; approval 2 ч; задание 24 ч; `stop` до полной остановки процесса                                                                                      | Движок должен реализовать сам; в jobs сейчас только ручной `stop`                                                                                                          | `stopJob` + таймаут шага; `needs-user` переводит в решение пользователя                                                                        |
| Дни             | 5–8; +3–4 за token/cost cap                                                                                                                                                                 | 10–15                                                                                                                                                                      | 3–5 навык + `model` в `job.start`; 8–12 полный движок                                                                                          |
| Тесты           | `plugin-agent.test.mjs`, `agent-jobs-api.test.mjs`, новый `plugin-jobs.test.mjs`, `plugins-ui.test.mjs`                                                                                     | `plugins.test.mjs`, манифест `core`, новый workflow-engine, `plugins-ui.test.mjs`, disable/restart                                                                         | `agent-jobs-api.test.mjs`, `projector-task.test.mjs`, `agent-skills.test.mjs`, `agent-jobs-commands.cases.mjs`                                 |

## Рекомендация и минимальный первый шаг

Рекомендую **C сейчас, A позже, B не делать**. Сначала нужен работающий role-team без нового
доверия и без обхода подтверждений; затем — узкий `api.jobs`, если авторство команд действительно
требуется.

Минимальный первый шаг (2–4 дня): добавить `selection`/`model` в `StartJobOptions` и аргументы
`ide.agent.job.start`, затем встроенный навык `role-team` со сценарием PLAN → WORKER → ADVISOR →
REVIEWER: PLAN делает Projector, WORKER — задание с ролью/моделью, ADVISOR и REVIEWER — `task` с
read-only ролью Projector или отдельные задания с явным подтверждением. Вердикт — JSON в `task`/
`result` с проверкой и fallback, дедлайн — `stopJob`, артефакты — `jobDiff` + `result` + `files`.
Это использует только существующие `jobs`/`task`/`roles` и обратимо.

Если после этого нужен именно плагинный оркестратор, добавлять `api.jobs` только с явным
`projectId`, списком разрешённых backend, запретом `unattended`/`bypassPermissions`/`origin`,
запретом `answer(allow)` и `merge`, лимитом параллельных заданий и записью в «Работы».

## Риски и проверки

- **Подмена подтверждения.** `POST /api/agent/jobs/:id/answer` принимает `allow: true` от любой
  страницы с Origin; плагин может подтвердить разрешение за пользователя. `unattended` делает это
  ещё проще; для A это должно быть запрещено на уровне API, а не UI.
- **Повышение режима.** `startFrom` берёт `body.mode`/`permissionMode` выше режима роли; плагин может
  поставить `bypassPermissions` или `plan` и обойти ожидания пользователя.
- **Чужой проект и worktree.** `projectId` не привязан к плагину; `isolate` создаёт ветку
  `projector/<id>` в `$XDG_DATA_HOME/projector/worktrees`, `merge` меняет проект; merge нельзя
  давать без отдельного действия пользователя.
- **Сироты и рестарт.** `recoverJobs` поднимает задания после рестарта, но выключение плагина во
  время задания не имеет политики (`docs/in-process/plugin-agents.md`); у серверного плагина нет teardown.
- **Нет учёта расхода.** `usage` не попадает в `job.json`/журнал; `readAgentUsage` читает историю
  чата. Бюджет в токенах/деньгах нельзя ни показать, ни остановить; только время и `budget` Claude.
- **Секреты.** `jobDiff` скрывает `.env`, ключи и `.ssh`, но `result` и журнал не фильтруются; оркестратор может собрать секрет, который агент прочитал.
- **Недоверенные артефакты.** Результат и diff задания — данные агента; REVIEWER не должен
  исполнять команды из них, а MERGE — только по просьбе пользователя.
- **Модели.** Выбор — это `backend + selection`; ids у агентов разные, семейства не проверяются; при отсутствии backend задание упадёт.
- **Проверки:** `/api/health` и `/api/status` до серверных тестов; `vp test related` для изменённых
  файлов; `vp run check` перед PR; сценарий — старт, `needs-user`, ответ, `stop`, diff, disable,
  повторный enable; браузерный плагин — reload страницы и Hub.

## Открытые вопросы

1. Role-team — продуктовый сценарий ядра или именно авторский плагин? От этого зависит C против A.
2. Должен ли плагин запускать задания только в активном проекте, или в любом из каталога?
3. Где хранить расход задания: `job.json` + `usage`-событие или отдельный ledger с `jobId`?
4. Разрешать ли Projector как job (для PLAN/ADVISOR), или оставить только `task` и оркестратор?
5. Чем гарантировать read-only для ADVISOR/REVIEWER: `task` или новый режим job без записи?
6. Нужен ли глобальный alias/семейство моделей вместо backend-specific `selection.model`?
7. Где состояние workflow: `plugins/data/<id>` (зарезервирован) или ядро?
8. Должен ли `context.commands.run` плагина разрешать изменяющие команды вроде `job.start`, или
   его нужно ограничить read-only командами?
