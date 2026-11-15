# Перехват тул-вызовов плагином

Рабочий документ. Контракт плагинов — [plugins](../plugins.md), устройство агентов — [architecture](../architecture.md), роли — [agent-roles](../agent-roles.md), незакрытые пункты плагинов — [plugin-agents](plugin-agents.md).

## Сейчас

### Хуки

- `packages/server/modules/agents/projector/projector-hooks.ts`: `HookEvent = "PreToolUse" | "PostToolUse" | "Stop"`, `Hook`, `loadHooks`, `withHooks`, `runStopHooks`; запись — `{ command, matcher?, timeout?, minSeconds? }`.
- Файлы: `$XDG_DATA_HOME/projector/agent/hooks.json` (пользователь) и `<cwd>/.projector/hooks.json` (проект, после `guardProjectHooks` в `projector-guard.ts` 182–194; «Всегда» живёт до перезапуска). API — `GET|PUT /api/agent/hooks` (`routes/api/agent-hooks.ts`), UI — `AgentHooksSettings.vue`, команды `ide.agent.hooks.get/set`.
- Вход: `spawn(command, { shell: true })`, stdin JSON `{ event, cwd, tool, input }` для Pre/Post и `{ event, cwd, seconds, text }` для Stop; env `PROJECTOR_HOOK_EVENT`, `PROJECTOR_PROJECT_DIR`; вывод обрезан до 2000 символов.
- Выход: код 2 → запрет, текст приходит модели как `Error("Хук запретил вызов: …")` и событие `tool-error` (`projector-backend.ts` 283–289); JSON `{"decision":"block","reason"}` — то же; `additionalContext` из `PostToolUse` дописывается к результату как `{ result, hook }`. `allow`, `ask` и перезапись входа не выражаются (`agent-roadmap.md` 17).
- Таймаут 30 с (`DEFAULT_TIMEOUT_MS`), поле `timeout` в секундах, затем SIGKILL. Блокирует только код 2; `spawn` error, другой код и убитый хук — пропуск, то есть **fail-open**.
- Порядок: пользовательские, затем проектные, последовательно; первый block прекращает `PreToolUse`, `PostToolUse` собирает контекст всех совпавших.
- Область: только бэкенд `projector`. `withHooks` вызывается один раз (`projector-backend.ts` 187–191) над `{ ...mcp.tools, ...own }`; для `side` хуки пустые. В `acp-backend.ts` и `plugins/claude-code/src/claude-code-backend.ts` хуков нет.

### Штатный агент

- Цикл: `streamText` с `stopWhen: () => true` и внешним `for` (`projector-backend.ts` 240–331); `tool-call`/`tool-result`/`tool-error` — события чата.
- Общая точка перед исполнением одна — обёртка ToolSet `withHooks`; ниже проверки точечные: `guardBash`, `guardCommand`, `guardMemory`, `guardWebFetch` (`projector-guard.ts`) из `agent-tools.ts` (79, 84, 119, 196, 254) и `guardMcpTool` из `projector-mcp.ts` 111. Абстракции «policy» нет.
- Режимы: control `permission-mode` (`projector-controls.ts` 9–34) — `default`, `auto`, `bypassPermissions`. `auto` включает модельного ревьюера `createBashReviewer` (`projector-review.ts`), `bypassPermissions` ставит `trusting: true` и пропускает guard'ы. Песочницы нет: `bash` — `os.tools.runBash` с правами пользователя (`agent-tools.ts` 307+), `docs/ide-commands.md` 293: «не sandbox».
- Approvals: `AgentRunOptions.approve` (`agent/backend.ts` 122) создаётся в `run-request.ts` 178–190 и `hosted-runner.ts` 97–109, обёрнут `createJudgedApproval` (`judge/approval.ts`). Судья (`judge/verdict.ts`: `judgeAction`, 8 с, 400 токенов, кеш 10 мин, при сбое score 4) может вернуть `true` без карточки. В фоновом задании без пользователя `approve` возвращает `true` вообще без Судьи (`agent/jobs.ts` 133–137).
- `judge`/`lens`/`doctor` — служебные роли: один вызов `projector` без инструментов, истории и файлов (`docs/agent-roles.md` 13–23). `judgeAction` — серверная функция; наружу только `GET|PUT /api/agent/judge` для настроек (`routes/api/agent-judge.ts`), вердикта по запросу нет.

### Плагины и ACP

- `PluginCodeApi` (`agents/plugin/code.ts` 123–143) и браузерный `PluginApi` (`packages/plugin-api/modules/api/index.ts` 192–207) перехвата не содержат: только `host`, `features`, `roles`, `widgets`, `mcp`, `providers.registerBalance`, `createAcpBackend`. `contributes` — themes/agents/balances/languages/panels/tabs (`docs/plugins.md` 42, `core/modules/plugins/index.ts` 251).
- Свой цикл плагин имеет только не-ACP: `plugins/claude-code` вызывает SDK и решает через `canUseTool` (`claude-code-backend.ts` 181–204), передавая запрос в `options.approve`. Декларативный ACP-агент цикла не имеет — его ведёт `acp-backend.ts`.
- Seam для доверенного ACP-плагина: `onRequest` сначала смотрит `program.extensions[method]` (`acp-backend.ts` 137–143), т.е. можно перехватить `session/request_permission` своего агента и позвать `options.approve`. В манифесте `extensions` запрещены (`core/modules/plugins/agent.ts` 46–49, `docs/plugins.md` 120) — только серверный код, и это не документированная возможность.
- ACP: Projector отвечает на `session/request_permission` (`decidePermission`, `acp-backend.ts` 358–399); `fs` и `terminal` в `initialize` выключены (`acp-process.ts` 99–108), поэтому агент правит файлы и запускает команды своими инструментами. Турн без таймаута (`NO_TIMEOUT`), ошибка обработчика — JSON-RPC `-32000` (`acp-client.ts` 82–84).
- Следствие: для чужого агента перехват возможен только там, где он сам спросит разрешение; принудительного гейта перед его тул-вызовом нет.

## Чего не хватает

- Регистрации: событие хука приходит только shell-команде из файла; ни манифест, ни API не дают плагину объявить `PreToolUse`/`PostToolUse`/`Stop`.
- Структурного решения: нет `allow`/`ask`/`rewrite`, причины отдельно от текста, привязки к пакету и его жизненному циклу.
- Единой точки: `withHooks` приватна для `projector`, `guard*` разбросаны по инструментам, MCP проверяется отдельно.
- Гейта для ACP: `approve` — запрос к пользователю, а не проверка; `bypassPermissions`, unattended-задания и агент, который не спрашивает, обходят его.
- Сервиса «судьи по запросу»: `judgeAction` недоступен ни по HTTP, ни из CLI (`packages/cli/commands` — server/logs/search/open/projects/run/status), ни плагину.
- Изоляции: guard плагина — код в процессе сервера, он видит аргументы и может молча разрешать.

## Варианты

### A. `api.agents.guards.register(event, handler)`

Реестр `packages/server/modules/agent-guards/`, поле в `PluginCodeApi`/`agents/plugin/code.ts` (рядом с `balanceDisposers`, 169–226), вызов из единой обёртки ToolSet в `projector-backend.ts` и из `decidePermission` для ACP. Свой цикл плагин проверяет сам через экспорт `check(call)`; для декларативного ACP — только точка permission request.

- Плюсы: структура (verdict + reason + source), жизненный цикл и dispose как у балансов, покрытие Projector + MCP + своих агентов, `ask` через существующий `permission-request`.
- Минусы: чужой ACP не принудить; нужен порядок нескольких плагинов; доверие расширяется на решения пользователя.
- Порядок: хуки → guards (priority убыв., затем имя пакета и id) → встроенный guard → Судья/approve → пользователь; `deny` побеждает, первый `deny` прекращает цепочку.
- Таймаут 2–5 с; `deny` при сбое — пропуск (как хуки), `ask` — карточка с пометкой «плагин», `allow` из плагина запрещён.
- Оценка 4–6 дней. Тесты: новый `packages/server/tests/tool-guards.test.mjs` — порядок, конфликты, timeout, disable/remove, hosted-процесс; `packages/server/tests/agent-catalog.cases.mjs`.

### B. Декларативные правила в манифесте

Новый вклад (например `contributes.policy`): `{ match: { tool, command?, path? }, action: "allow" | "deny" | "ask", reason? }`; валидация в `packages/core/modules/plugins` (`assertAllowedKeys`, `agent.ts` 46–49), применение в тех же воротах, что A.

- Плюсы: данные, а не код; покрыто хешем доверия; аудит и ревью правил; работает для декларативного ACP без серверного модуля.
- Минусы: regex по команде обходится кавычками, `bash -c`, base64, интерпретаторами; правки файлов и MCP так не описать; semantic-судью не заменить; нужен лимит и порядок; `ask` требует UI.
- Оценка 3–4 дня (после ворот). Тесты: схема и неизвестные поля, битый regex, приоритет, конфликт allow+deny (deny побеждает), `bypassPermissions`.

### C. Только shell-хуки, судья — отдельный сервис

Работает сейчас, но только для `projector`. Доверенный плагин технически может писать `agent/hooks.json` (код в процессе сервера), но это затирает файл пользователя и переживает disable — так делать нельзя.

- Нужно: endpoint вердикта (`POST /api/agent/judge/verdict` с `accessAllowed`, как в `routes/api/agent-judge.ts`) или CLI-команда; скрипт читает stdin, печатает `{"decision":"block","reason":…}` и выходит с 2. `judgeAction` уже кеширует и ограничен 8 с.
- Порядок: процесс на каждый вызов, пользовательские хуки раньше проектных, `timeout` 30 с больше бюджета Судьи. Код 1 = пропуск, поэтому «нет вердикта» скрипт обязан отдавать как block.
- Плюсы: без изменений ядра, протокол покрыт `packages/server/tests/agent-hooks.test.mjs`, Судья реализован.
- Минусы: нет ACP и Claude Code; задержка процесса + модели на каждый вызов; нет `ask` и контекста кроме `{ tool, input }`; нет жизненного цикла; конфликты с хуками пользователя.
- Оценка 1–3 дня. Тесты: доступ к маршруту, deny/allow скрипта, таймаут, `Stop` не блокирует.

### D. Policy-engine в ядре, плагины поставляют правила

Контракт `packages/core/modules/agent-policy`, движок `packages/server/modules/agent-policy`, источники: встроенные правила (`guardBash`, `isForbiddenPath`), адаптер хуков, правила плагинов (A/B), адаптер Судьи. `evaluate(call)` до `execute` у Projector, обёртка вокруг `decidePermission` у ACP и экспорт для циклов плагинов.

- Плюсы: одно место, детерминированно и тестируемо; работает для unattended-заданий (`jobs.ts` 133–137), которые сейчас разрешают всё; встроенные проверки перестают быть разрозненными; хуки становятся одним из источников.
- Минусы: самый большой объём; ACP не принудить; риск ложных блокировок; дизайн контракта и миграция встроенных проверок.
- Порядок: `deny > ask > allow`, фиксированный порядок источников, событие аудита в «Работу».
- Оценка 8–12 дней. Тесты: табличные кейсы, `bash`/MCP, ACP permission, unattended job, `side` без хуков.

## Рекомендация и минимальный первый шаг

**D как основание, A как единственная поверхность для плагинов, B как сериализация тех же правил.** C — временный обход только для Projector, пока ворот нет.

Минимальный первый шаг (2–3 дня, без публичного API): вынести проверку в `packages/server/modules/agent-guards/` с `evaluate(call) → "deny" | "ask" | "pass"` и вызвать первой строкой обёртки ToolSet в `projector-backend.ts` (сейчас `withHooks`, 198–227); перенести туда `isForbiddenPath`/`commandIsSafe` как встроенный источник; вердикт показывать строкой в «Работе». Это даёт точку расширения, не фиксируя плагинный контракт. Затем A (4–6 дней), затем B (3–4).

## Риски и проверки

- Доверие: guard плагина — код в процессе сервера (`docs/plugins.md` 210), он уже может всё; новый риск — подавление карточки подтверждения. Ограничение: только `deny`/`ask`, снятие встроенного guard'а и `allow` запрещены; `ask` — после явного разрешения пакету; каждое автоматическое решение видно в «Работе».
- Fail-open: протокол хуков пропускает при любом коде кроме 2 и при `spawn` error; переиспользовать его для guard'а нельзя без явного `fail-closed` для `ask`.
- Hosted-процессы: ответ Projector и плагина идут отдельно (`app/projector-runner.ts`, `app/plugin-runner.ts`); реестр нужно регистрировать там же, иначе в hosted-ходе он пуст (та же ловушка, что с каталогом возможностей, `docs/agent-features.md` 37).
- Жизненный цикл и HMR: dispose при disable/remove/смене хеша, без двойной регистрации; открытые пункты — `docs/in-process/plugin-agents.md` 12–25.
- Секреты: аргументы могут содержать значения (`request_secret`, MCP, env); guard получает усечённый и маскированный вход, логи не хранят значения.
- Проверки: `packages/server/tests/agent-hooks.test.mjs` (протокол), `packages/core/tests/agent-judge.cases.mjs`, `packages/server/tests/plugin-agent.test.mjs`, `packages/server/tests/plugin-agents.test.mjs`, `packages/server/tests/agent-catalog.cases.mjs`, `evals/judge.test.mjs`; новый тест ворот. Вручную: карточка ACP-агента, `bypassPermissions`, unattended-задание, `/btw`, HMR и hosted-ход.

## Открытые вопросы

- Разрешать ли плагину `ask` (новый источник карточек) или только `deny`?
- Допустимо ли `allow`-правило в манифесте или политика только сужает встроенную?
- Нужна ли перезапись входа (`rewrite`), которой нет и в хуках?
- Как сообщать в UI, что ACP-агент не спрашивает разрешений и гейта для него нет?
- Приоритет при равенстве: как у языков (`priority` → имя пакета → id, `docs/plugins.md` 252)?
- Гейт для `task` и `side`: у `side` хуки выключены; сохранять ли это?
- Версия контракта: новые поля манифеста при `apiVersion: 1` или 2?
