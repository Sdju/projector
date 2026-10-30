# Независимость общего кода от агентов

План выноса упоминаний конкретных агентов из общих модулей Projector. Состояние на 2026-10-30 взято из кода, не из замеров. Агенты сейчас: Projector (встроенный), Claude Code (Agent SDK в процессе сервера), Codex, OpenCode, Cursor и Kimi (ACP).

## Границы

**Нормально, когда агент знает о себе всё.** Его программа, диалект ACP, вопросы, формат авторизации, промпт, лейбл, иконка, команды и лимиты живут в его модуле: `server/modules/agents/<agent>/`, `server/modules/agents-integration/<agent>/`, `src/modules/agents-integration/<agent>/`.

**Плохо, когда общий код знает имя агента.** Ядро чата, терминал, workspace, настройки, OS-адаптер и клиентские модели не должны перечислять агентов, сравнивать `backend === "…"` и хранить их лейблы. Они работают с реестром и контрактом.

Инвариант уже записан в [архитектуре](architecture.md) для серверного ядра, но ничем не проверяется и не покрывает клиент, терминал и `core/modules/os`.

## Отправная точка

| Слой                                                               | Что захардкожено                                       | Оценка       |
| ------------------------------------------------------------------ | ------------------------------------------------------ | ------------ |
| `server/modules/agent` (ядро)                                      | ничего, только `capabilities` и методы бэкенда         | хорошо       |
| `server/modules/agents/<agent>`                                    | всё про агента                                         | хорошо       |
| `server/modules/agents/acp`                                        | общий маппер, но в `acp-elicitation.ts` — формат Codex | почти хорошо |
| `server/app/agents.ts`, `server/app/api.ts`                        | регистрация и роуты — это композиция                   | нормально    |
| `server/app/features.ts`                                           | `AGENTS` с лейблами дублирует бэкенды                  | дубль        |
| `server/modules/preferences/preferences.ts`                        | `GUI_AGENT_PROGRAMS`, `TOGGLEABLE_AGENTS`              | дубль        |
| `server/modules/terminal/terminal.ts`                              | список программ, `cursor → agent`, заголовки           | протечка     |
| `core/modules/terminal/contract.ts`                                | `TerminalProgram` — закрытый union                     | протечка     |
| `core/modules/ide/command-help.ts`                                 | help-текст с именами программ                          | протечка     |
| `core/modules/os*`                                                 | чтение кредов четырёх агентов, env-маркеры Claude Code | протечка     |
| `src/modules/agent/model/types.ts`                                 | `AgentBackendId` — закрытый union                      | протечка     |
| `src/modules/agent/model/modes.ts`                                 | `guiPrograms`, `agentLabels`, `programBackend`         | дубль        |
| `src/modules/agent/model/job-commands.ts`, `lib/job-labels.ts`     | карты агентов и вкладок                                | дубль        |
| `src/modules/workspace/ui/NewSessionMenu.vue`                      | строки меню, подписи, иконки                           | дубль        |
| `src/modules/workspace-api/local.ts`, `workspace/lib/tab-views.ts` | по пять одинаковых типов вкладок                       | дубль        |
| `src/modules/workspace/lib/workbench-layout.ts`                    | валидация программ и текст ошибки                      | дубль        |
| `native/`, `launcher`, `vio`, `cli`                                | ничего                                                 | хорошо       |

Перечисления уже разъехались: Kimi отсутствует в ошибке `server/routes/api/agent-jobs.ts:37`, в ошибке `src/modules/workspace/lib/workbench-layout.ts:350` и в перечислении агентов в `server/modules/agents/projector/prompts.ts:7-8`. Лейбл «Claude Code» определён независимо шесть раз, маппинг `claude ↔ claude-code` — в пяти файлах.

## Инварианты

Готово, когда выполняются все пункты:

1. В общих модулях нет строк с id, лейблами и программами агентов.
2. Нет сравнений `backend === "<agent>"`, кроме явно объявленной возможности бэкенда.
3. Список агентов, их порядок, лейблы, программы и вкладки берутся из реестра.
4. Добавление агента — новый модуль и одна строка регистрации на сервере и одна на клиенте.
5. Ошибки и help-тексты не перечисляют агентов вручную.
6. Инвариант проверяется тестом, а не только ревью.

## Фаза 0. Страж

**Сейчас.** Архитектурная проверка (`vp run architecture`) следит за импортами, циклами и размерами, но не за именами агентов. Протечки появляются снова при каждой новой интеграции.

**Делаем.** Тест `tests/agent-independence.test.mjs` читает исходники и падает, если находит имя агента в общем коде:

- проверяемые каталоги: `server/modules/agent`, `server/modules/terminal`, `core/modules/terminal`, `core/modules/ide`, `core/modules/os`, `core/modules/os-posix`, `src/modules/agent/{model,lib,ui}`, `src/modules/workspace`, `src/modules/workspace-api`, `src/modules/app-settings`;
- исключения: `server/modules/agents/**`, `server/modules/agents-integration/**`, `src/modules/agents-integration/**`, композиция `server/app/**` и `src/app/**`;
- шаблон: слова `claude`, `codex`, `kimi`, `opencode` целиком плюс `"cursor"`/`'cursor'` в кавычках — слово `cursor` без кавычек в CSS и CodeMirror означает каретку;
- комментарии перед проверкой вырезаются, чтобы объяснения не роняли тест.

Второй тест сверяет паритет: у каждого зарегистрированного бэкенда есть `label`, `program` (если у него есть терминал) и запись в клиентском каталоге. Он включается после фаз 1–2.

Тест вводится с **базовой линией**: известные нарушения перечислены в самом тесте (файл → шаблон), как записи `extra.largeFiles` в `feod.config.mjs`. Тест падает, если имя появилось вне списка, и если запись больше не нужна, — тогда её удаляют вместе с выносом. К концу фазы 6 список пуст.

**Готово, когда.** Добавление строки `"claude-code"` в `server/modules/agent/registry.ts` или `"codex"` в `terminal.ts` роняет тест, а allowlist объяснён в самом тесте и сокращается по фазам.

## Фаза 1. Сервер: реестр — единственный каталог

**Сейчас.** `registerAgentBackend` умеет только добавлять и заменять бэкенд; перечислить их нельзя. Поэтому `server/app/features.ts`, `server/modules/preferences/preferences.ts` и тексты ошибок держат свои копии списка.

**Делаем.**

1. Расширить `AgentBackend` полями `label` и `program` (id терминальной программы; у Projector его нет). У ACP-агентов лейбл берётся из `AcpProgram.label`, чтобы он не заводился второй раз. `builtin?: true` помечает штатного агента.
2. Добавить в `server/modules/agent/registry.ts` `listAgentBackends()` — массив `{ id, label, program, builtin, capabilities }` в порядке регистрации.
3. `server/app/features.ts`: регистрировать возможности циклом по `listAgentBackends()` вместо литерала `AGENTS`.
4. `preferences.ts`: заменить константы на каталог, переданный из композиции (`configureAgentPreferences({ agents: () => … })` или провайдеры `programs`/`toggleable`). Направление импорта `registry → preferences` сохраняется, обратного быть не должно — иначе цикл.
5. `GET /api/agent/backends` — новый ответ для клиента: `{ backends: [{ id, label, program, builtin, capabilities }] }`. `GET /api/agent/modes` продолжает отдавать режимы и `disabled`, поле `programs` берётся из реестра.
6. Тексты ошибок `agent-jobs.ts` и `job-commands.ts` собирать из лейблов реестра.

**Готово, когда.** В `features.ts` и `preferences.ts` нет имён агентов; новый бэкенд автоматически появляется в настройках возможностей, его можно выключить, а `/api/agent/modes` возвращает его программу.

## Фаза 2. Клиент: каталог агентов

**Сейчас.** Клиент не имеет реестра: меню «+», карты заданий, типы вкладок, лейблы и валидации держат свои списки. Сервер уже отдаёт `programs`, но клиент его игнорирует.

**Делаем.**

1. Новый модуль `src/modules/agents-integration/catalog.ts`:

   ```ts
   export interface ClientAgent {
     backend: string; // claude-code
     program: string; // claude
     title: string;
     caption: string;
     icon: Component;
     builtin?: boolean;
     usage?: Component;
   }
   ```

   и функции `registerClientAgent`, `clientAgents`, `clientAgentOf(program)`, `clientAgentByBackend(backend)`, `clientAgentPrograms`.

2. Композиция `src/app/agents.ts` (`registerBuiltinClientAgents`) и вызов в `src/app/entry.ts` до `createApp(...).mount()` — как у виджетов в `src/app/widgets.ts`. Регистрация идемпотентна: повтор заменяет запись.
3. Каждый `src/modules/agents-integration/<agent>/index.ts` экспортирует свой `ClientAgent`; иконки остаются статическими импортами внутри модуля агента.
4. Перевести на каталог: `NewSessionMenu.vue` (строки = Shell + каталог), `model/modes.ts` (лейблы, программа → backend), `model/job-commands.ts` (алиасы `claude`/`claude-code`), `lib/job-labels.ts` (backend → вкладка), `workspace-api/local.ts` и `workspace/lib/tab-views.ts` (цикл по каталогу вместо пяти блоков), `ui/AgentIntegrationsSettings.vue`.
5. `types.ts`: `AgentBackendId = string` (на сервере уже так); `AgentPermissionMode` временно оставить, в фазе 5 сделать строкой.
6. `AgentUsageIndicators.vue`: либо оставить явную композицию (допустимо — это UI-корень), либо рисовать по `usage` из каталога.

Порядок безопасен: регистрация идёт в `entry.ts` до монтирования, профили workspace создаются позже. Тесты, которые создают `createLocalWorkspaceProfile` напрямую, вызывают `registerBuiltinClientAgents()` в начале. Импорт `workspace-api` из `agents-integration` допустим: модуль указан в `transitModules` файла `feod.config.mjs`.

**Готово, когда.** Новый агент на клиенте — это `<agent>/index.ts` с дескриптором и одна строка в `src/app/agents.ts`; в перечисленных файлах не осталось имён агентов.

## Фаза 3. Терминальные программы

**Сейчас.** Список программ продублирован в четырёх местах, `cursor` запускается как `agent` прямо в общем коде, заголовки вкладок — отдельной картой.

**Делаем.**

1. В дескрипторе бэкенда объявить терминал: `terminal?: { program: string; executable: string; title: string }`. Для Claude Code это `claude`, для Cursor — программа `cursor`, исполняемый файл `agent`.
2. `server/modules/terminal/terminal.ts`: `shell` остаётся встроенным, остальное берётся из реестра; проверка программы, исполняемый файл и заголовок — из дескриптора.
3. `core/modules/terminal/contract.ts`: `TerminalProgram = string`.
4. `src/modules/workspace/lib/workbench-layout.ts`: убрать список; проверять по клиентскому каталогу и `shell`, ошибку отдаёт сервер.
5. `core/modules/ide/command-help.ts`: удалить ветку `ide.workbench.terminal.new` — команда в `workbench-layout.ts` передаёт свои `arguments` при регистрации.
6. Тесты терминала регистрируют встроенные бэкенды, как это делает сервер.

**Готово, когда.** `rg -i "claude|codex|cursor|kimi|opencode" server/modules/terminal core/modules/terminal core/modules/ide` пуст (кроме комментариев), а `cursor` по-прежнему запускает `agent`.

## Фаза 4. OS-адаптер

**Сейчас.** `core/modules/os` и `core/modules/os-posix` знают четыре агента: пути и формат их файлов авторизации, запуск Codex app-server и env-маркеры Claude Code. Новый агент с авторизацией требует правок в core на каждой ОС.

**Делаем.**

1. Вынести `configHome` в фасад `os` (рядом с `dataHome`); `homeDirectory` и `platform` уже есть.
2. Удалить `readCursorAccessToken`, `readKimiAccessToken`, `readOpenCodeGoKey`, `startCodexAppServer` из `os.ts`, `os-posix/*` и `os/modules/windows/*` вместе с ре-экспортами в `linux/index.ts` и `windows/index.ts`.
3. Перенести чтение и разбор кредов в `server/modules/agents-integration/<agent>/credentials.ts`: модуль строит кандидатов из `os.configHome()`/`os.dataHome()`/`os.homeDirectory()`, читает файл (серверу `node:fs` разрешён) и проверяет токен и срок. Env-override (`CURSOR_AUTH_CONTENT` и т. п.) остаётся там же.
4. Codex app-server запускать общим `os.tools.spawnProcess` (или существующим `spawnAgentProcess`, если хватает его stdio); программа, аргументы и `stdio` — в `agents-integration/codex/cli.ts`.
5. `clearAgentSession` заменить на `os.clearSessionEnv(names)`; список `AGENT_SESSION_ENV` перенести в `server/modules/agents/claude-code/`, вызов в `server/app/plugin.ts` — с этим списком.

**Готово, когда.** В `core/modules/os` и `core/modules/os-posix` нет имён агентов; лимиты всех пяти агентов по-прежнему работают на Linux и Windows (проверить `read*`-ветки тестами интеграций).

## Фаза 5. Контракт и поведенческие спец-случаи

**Сейчас.** Четыре места реальной логики в общем коде.

**Делаем.**

1. `server/routes/api/agent-jobs.ts:64-67`: убрать ветку `backend === "claude-code"`. Минимально — передавать режим и в `permissionMode`, и в `selection["permission-mode"]`, и в `selection.mode`; бэкенд читает свой. Правильнее — одно поле `mode` в `StartJobInput` и нормализация в бэкенде.
2. `server/modules/agents/acp/acp-elicitation.ts:37,52,79`: убрать `_meta.codex` и литерал `"None of the above"`. Добавить в `AcpProgram` необязательный адаптер форм (`companion(field, properties)`, `baseOf(field)`, `fallbackOption(options)`), реализовать его в `server/modules/agents/codex/`, общая часть работает по умолчанию.
3. `server/modules/terminal/terminal.ts:238`: переносится в дескриптор агента (фаза 3).
4. Клиент: заменить девять проверок `backend !== "projector"` (`external.ts:51`, `session.ts:58,234,238`, `chat-fork.ts:47`, `AgentChat.vue:51`, `agent-commands.ts:40,44`, `session-commands.ts:7`) на `builtin` из каталога или `capabilities`.
5. `AgentPermissionMode` на клиенте — `string`: у ACP-агентов свои режимы, union вводит в заблуждение.
6. Проверку `disabledAgents` в `registry.runAgent` можно оставить: это единственная политика, которую ядро применяет само. Если убирать — то в пользу общего `startRun`, а не маршрута.

**Готово, когда.** В `agent-jobs.ts` и `acp-elicitation.ts` нет имён агентов; клиент не сравнивает `backend` с `projector`.

## Фаза 6. Тексты и дрейф

**Сейчас.** Перечисления в промпте штатного агента и в ошибках отстают от списка агентов (Kimi уже выпал). Промпт — знание агента о себе, но перечисление можно брать из реестра.

**Делаем.**

1. `server/modules/agents/projector/prompts.ts`: вместо литералов — лейблы из `listAgentBackends()` при сборке промпта (промпт собирается на каждый ход, стоимость нулевая) либо нейтральная формулировка «внешние кодовые агенты» со ссылкой на `ide.agent.jobs.list`.
2. Ошибки и описания IDE-команд в `agent-jobs.ts`, `job-commands.ts`, `AgentIntegrationsSettings.vue`, `agent-features/model/defaults.ts` собирать из каталога.
3. Проверить `docs/usage.md` и `docs/ide-commands.md` на устаревшие перечисления.

**Готово, когда.** Ни одно сообщение об ошибке не перечисляет агентов вручную; после добавления седьмого агента тексты обновляются сами.

## Фаза 7. Документация

- Дополнить раздел агентов в [архитектуре](architecture.md) ссылкой на этот план и упоминанием клиентского каталога.
- Добавить документ в список [AGENTS.md](../AGENTS.md).
- Отметить в [карте кода](session-notes.md), где теперь живёт каталог агентов.

## Порядок и размер

| Фаза                  | Размер       | Что даёт                                                            |
| --------------------- | ------------ | ------------------------------------------------------------------- |
| 0. Страж              | S (0.5 дня)  | инвариант перестаёт нарушаться незаметно                            |
| 1. Реестр на сервере  | M (1–2 дня)  | серверные списки исчезают, новый агент работает без правок настроек |
| 2. Каталог на клиенте | M (2–3 дня)  | клиент перестаёт быть узким местом, ~10 файлов без литералов        |
| 3. Терминал           | M (1–2 дня)  | программы и `cursor → agent` — в модулях агентов                    |
| 4. OS-адаптер         | M (1–2 дня)  | креды и env — в интеграциях, core не знает агентов                  |
| 5. Контракт           | S–M (1 день) | не остаётся поведенческих спец-случаев                              |
| 6. Тексты             | S (0.5 дня)  | промпты и ошибки не дрейфуют                                        |
| 7. Документация       | S            | карта соответствует коду                                            |

Порядок: 0 → 1 → 3 → 2 → 4 → 5 → 6 → 7. Фаза 0 сразу фиксирует достигнутое и не даёт новым правкам добавить имена. Фазы 1 и 3 убирают протечки из сервера и терминала; фаза 2 — самая объёмная по файлам, но механическая. Фаза 4 независима и может идти параллельно. В сумме — около полутора-двух недель одного разработчика; половина ценности достижима после фаз 0–1.

## Риски

- **Порядок инициализации.** Сервер читает настройки при запросе, поэтому регистрация бэкендов успевает; клиентский каталог должен заполняться в `entry.ts` до монтирования, иначе меню и профили увидят пустой список. Регистрация должна быть идемпотентной.
- **Цикл `registry ↔ preferences`.** Сейчас `registry` импортирует `preferences`; после фазы 1 `preferences` не должен импортировать реестр — каталог передаётся провайдером из композиции.
- **Потеря типобезопасности.** `AgentBackendId = string` перестаёт ловить опечатки. Компенсация — тест паритета «backend ↔ каталог ↔ терминал».
- **`cursor` как слово.** Проверка на имена должна игнорировать CSS и CodeMirror, иначе тест будет воевать с `cursor: pointer`.
- **Иконки.** Динамический id иконки не подходит статической сборке: `icon` остаётся компонентом в модуле агента, а не строкой.
- **Тесты без композиции.** Тесты, создающие профиль workspace или терминал напрямую, должны регистрировать встроенных агентов; иначе «неизвестная программа».
- **Проекты Docker и Dev Container.** Резолв программы и заголовка через реестр должен сохранить текущее поведение изолированных проектов.
- **Совместимость `/api/agent/modes`.** Поле `programs` можно удалять только после перехода клиента на каталог (фаза 2).

## Проверка

```bash
vp run check
vp test run tests/agent-independence.test.mjs tests/agent.test.mjs \
  tests/agent-jobs-api.test.mjs tests/terminal.test.mjs \
  tests/agents-integration.test.mjs tests/agent-chat-tab.test.mjs \
  tests/agent-features.test.mjs
```

Вручную: меню «+» и переключатель TUI/GUI, выключение Kimi в настройках интеграций, запуск фонового задания и открытие его вкладки, `ide.workbench.terminal.new` для каждой программы, индикаторы лимитов, терминал в Docker-проекте.

## Что не делаем

- Динамическую загрузку агентов как плагинов: список агентов остаётся статическим, меняется только место его объявления.
- Перенос диалектов, промптов и форматов авторизации из модулей агентов: это их знание о себе.
- Общий словарь режимов разрешений для всех агентов: у ACP-агентов свои значения, нужен только маппинг.
- Массовую замену `node:fs` в серверных модулях: ограничение `confine` касается `src` и `core`, сервер читает файлы сам.

## Чек-лист независимости

- [ ] `tests/agent-independence.test.mjs` существует и зелёный.
- [ ] Реестр умеет перечислять агентов; `/api/agent/backends` отдаёт каталог.
- [ ] `features.ts` и `preferences.ts` не содержат имён агентов.
- [ ] Клиентский каталог в `src/modules/agents-integration/catalog.ts` заполняется из `src/app/agents.ts`.
- [ ] Терминал, `core/modules/ide` и `core/modules/os` не содержат имён агентов.
- [ ] В общем коде нет `backend === "<agent>"`.
- [ ] Новый агент добавляется новым модулем и одной строкой регистрации на сервере и на клиенте.
- [ ] Ошибки и промпты не перечисляют агентов вручную.
