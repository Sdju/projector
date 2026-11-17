# OpenCode: обрыв после отчёта фонового сабагента — evidence и передача

## Повторная проверка и исправление 17 ноября

Разделы ниже сохраняют исходный разбор и описание первой версии фикса. Текущая реализация
отличается от §5–7:

- `prepareFollowUp` фиксирует позицию БД **до** `session/prompt`. Быстрое продолжение не
  теряется, даже если его `idle` записан до начала ожидания.
- OpenCode получает один окончательный `done` после всей цепочки. Текст продолжает идти
  потоково; клиент сохраняет `run` для переподключения после завершения последнего ребёнка.
- Watcher опрашивает родителя **и всех новых детей** на каждой итерации. Повторный фон
  удерживает соединение; после последнего ребёнка снова действует окно ожидания отчёта.
- Граница пользовательского хода определяется по первому и последнему `user` после
  зафиксированной позиции, а не по типу последней записи. Во время продолжения обновления
  проверяются до передачи мапперу; события более позднего пользовательского хода отбрасываются.
- Таймаут, отсутствие схемы/БД и прерывание — отдельные результаты с событием `error`,
  а не успешный `done`. Keep-alive устанавливается до наблюдения; ошибка записи видима.
- Регрессии проверяют повторный фон, быстрое завершение, скрытый за assistant пользовательский
  ход, потерю наблюдения, таймаут и переподключение клиента.

Ограничения остаются: адаптер использует внутреннюю SQLite-схему OpenCode и временные окна
(5 секунд после последнего ребёнка, 3 секунды тишины, предел наблюдения 20 минут).
Это не гарантия доставки произвольно позднего отчёта. Автоматическое восстановление наблюдения
после таймаута и владение нативной сессией между несколькими процессами здесь не реализованы.
Ручной live-сценарий из §6 не заменяется модульными тестами.

Рабочий материал для передачи. Фикс лежит в рабочем дереве, **не закоммичен**; незавершённую
работу по ошибкам и квотам (`docs/in-process/agent-errors.md`) не трогал.

Смежные документы: [acp-background-lifecycle](acp-background-lifecycle.md),
[opencode-background-subagents](opencode-background-subagents.md),
[agent-errors](agent-errors.md).

## 1. Короткий вывод

Провайдер не падал: обе сессии OpenCode завершились `idle_outcome=succeeded`. Разрыв был наш:

1. Ответ закончился (`end_turn`), но фоновый сабагент ещё работал → hard hold, сокет жив.
2. Сабагент закончил → OpenCode записал `idle_outcome=succeeded` и **в ту же секунду** добавил в
   родительскую сессию synthetic-сообщение с результатом, запустив новый шаг.
3. Снятие последнего удержания и запуск нового шага — одно событие. `waitBackground` завершился,
   `keepProcess` был `false`, `finally` вызвал `connection.close({ stop: true })`, `agent-host`
   отправил `SIGTERM`, шаг упал: `finish=error`, `error.type=aborted`,
   `error.message="Step interrupted"`.
4. Обещанное «как закончит — подключу» не пришло; пользователь через 13 минут сам спросил
   «чем закончилось?».

Фикс: после последнего удержания процесс больше не останавливается, а run ждёт шаг, который
OpenCode запускает сам, и стримит его в тот же ответ. Окончательный `done` — один, после всей
цепочки; ошибка наблюдения, таймаут или aborted-шаг показываются как ошибка, а не как успех.

## 2. Точный таймлайн

Время локальное (`+05`, Asia/Yekaterinburg). Источник — `~/.local/share/opencode/opencode.db`,
таблицы `session_v2` и `session_message`; `time_created` — epoch ms.

| Время (+05)                 | seq       | Что                                                                                 | Источник        |
| --------------------------- | --------- | ----------------------------------------------------------------------------------- | --------------- |
| 02:57:06.422                | 2964      | user: «продолжай также активно используя сабагентов»                                | session_message |
| 02:57:06.526 … 03:03:42.155 | 2965…3411 | 43 assistant-шага, последний `finish=stop`, 370 символов                            | session_message |
| 03:00:35.372                | —         | создан дочерний `ses_e199faadbffeaiBsc1QLgjNX80` («Server chat resume worker»)      | session_v2      |
| 03:03:54.453                | 3418      | `idle`, `outcome=succeeded` — родитель закончил ответ                               | session_message |
| 03:07:49.825                | —         | дочерний `idle_outcome=succeeded`                                                   | session_v2      |
| 03:07:49.860                | 3421      | `synthetic` от сабагента, `state=completed`                                         | session_message |
| 03:07:49.922                | 3422      | assistant создан (62 мс после synthetic)                                            | session_message |
| 03:07:50.273                | 3422      | тот же assistant завершён: `finish=error`, `error.type=aborted`, `Step interrupted` | session_message |
| 03:20:30.925                | 3427      | user: «чем закончилось?»                                                            | session_message |
| 03:23:53.669                | 3585      | `idle` — ответ на вопрос закончен                                                   | session_message |
| 03:25:36.237                | 3588      | user: «сделай фиктивный вызов со скрином…»                                          | session_message |
| 03:31:16.590                | 3928      | `idle`, `outcome=succeeded` — финальный ответ                                       | session_message |

Проекторская сторона:

- `recent-runs.json`, запись `54c63b6ba00e`: `chat=…:a7e338e2-…`, `status=done`,
  `startedAt=1794867934979` (03:25:34.979), `endedAt=1794868276691` (03:31:16.691).
- `history.sqlite`, чат `…:a7e338e2-…`: 18 turns, последний — assistant в 02:57:05 (374 символа,
  `tasks: 1` — фоновый сабагент). Ходов 03:20 и 03:25 в истории нет.
- `history.sqlite`, `chat_index`: `updated=2026-11-16T22:30:50.220Z` (03:30:50.220 +05),
  `session=ses_e19f77cb7ffeaoj6Zc5jGEe74g`. `chats.revision=2371`.

## 3. Где именно рвётся код

Все ссылки — рабочее дерево на момент передачи; номера строк могут сместиться.

1. **OpenCode помечает фон как hard hold.**
   `packages/server/modules/agents/opencode/dialect.ts:18-20` — комментарий: фоновый subagent
   живёт на том же ACP-соединении (permissions + notify), поэтому `hold: true`.
   `dialect.ts:283` — патч `background: true` для `subagent` с `background:true`.
   `dialect.ts:338-350` — `poll()` снимает hold по `openCodeIdleOutcomes`.

2. **Удержание считается по `pending`, но факт «фон вообще был» нигде не хранился.**
   `packages/server/modules/agents/acp/acp-background-hold.ts:8-70`.
   `pending` опускается до нуля, `keepsProcess` становится `false`. Это и есть точка, в которой
   старый код решал, что больше ничего не нужно.

3. **Сабагент считается завершённым только по `idle_outcome`.**
   `packages/server/modules/agents/opencode/sessions.ts:75-108`, `openCodeIdleOutcomes`.
   Это уже исправление `4e9b766f`; до него `time_suspended` (очередь исполнения, стоит всё время
   работы ребёнка) принимался за остановку, и hold снимался через секунду после спавна.

4. **Конец хода закрывает ACP с `stop` по `keepProcess`.**
   `packages/server/modules/agents/acp/acp-backend.ts:228-249`:
   `waitBackground` → `keepProcess = mapper.keepsProcess` → `finally` →
   `connection.close({ stop: !keepProcess || aborted })`.

5. **`stop:true` — это SIGTERM дереву.**
   `packages/server/modules/agents/acp/acp-client.ts:181-193`: `close({stop:false})` вызывает
   `detach`; иначе `child.terminate()`/`kill()`.
   `packages/cli/app/agent-host.ts:56-67` и `:184-190`: при `turnFinished` закрытие сокета вызывает
   `endTurnProcess()`; с маркером `keep-alive` — `armIdle()` (`IDLE_MS=30 мин`), без него —
   `child.kill("SIGTERM")`.

Ключевая гонка: `waitBackground` просыпается ровно на записи `idle_outcome` ребёнка, а OpenCode в
этот же момент ставит synthetic и начинает новый шаг. Между `idle` ребёнка и synthetic — 35 мс;
между synthetic и созданием assistant — 62 мс. Практически hold снимает опрос раз в секунду
(если notify всё-таки придёт на wire, тот же эффект даёт `background.chunk`).

Два следствия, которые легко принять за ошибку при чтении кода:

- `acp-backend.onNotification` намеренно не фильтрует `session/update` по `sessionId`: OpenCode
  присылает события дочерних сессий в тот же поток, а диалект размечает их через
  `_meta["opencode/child-session"]` и `<session id>:<call id>`. Не добавлять фильтр «только
  родитель» — сломаются permissions и прогресс детей.
- После `end_turn` отправляется **один** окончательный `done`: не сразу, а после всей цепочки
  «родитель + повторно запущенные дети». Ранний `done` остался только в ветке без hard hold.
  Новые потребители `done` должны учитывать, что ответ может быть `busy` дольше обычного.

## 4. Почему `4e9b766f` не хватило

Коммит `4e9b766f` («не обрывать фоновых сабагентов после ответа», 01:45) изменил только
`openCodeIdleOutcomes`: `time_suspended` больше не считается завершением, только `idle_outcome`.
Это правильно, но последний переход остался прежним: когда **последний** ребёнок завершился,
`pendingBackground=0`, `keepProcess=false`, соединение закрывается с `stop`. То есть коммит
отодвинул SIGTERM с «через секунду после спавна» до «в момент отчёта последнего ребёнка» — ровно
на старт шага-продолжения.

## 5. Что сделано сейчас

### 5.1. Факт фоновой работы запоминается

`acp-background-hold.ts`: флаг `held`, выставляется при первом hard hold (`background:true`,
`hold!==false`, `running`); геттер `held`. `acp-events.ts:288-290`: `hadBackground`.

### 5.2. Конец ответа вынесен в `settleAcpAnswer`

`packages/server/modules/agents/acp/acp-follow-up.ts`:

- без hard hold (`followUp` не передан): `answer.finish()`, один `done`, при необходимости
  `status: background`, `waitBackground(abort)`, keep-alive только при `answer.keepsProcess`;
- с hard hold: **сразу** пишется `keep-alive` (страховка до конца наблюдения). Если запись
  невозможна — видимая ошибка `Не удалось сохранить процесс агента при отключении` и `return true`;
  это не «тихий успех», но и не SIGTERM;
- затем `followUp.wait({signal, pending: () => answer.pollBackground(), onStart})`;
- `pending` опрашивает диалект на каждой итерации, поэтому дети, запущенные **самим**
  продолжением, тоже удерживают ход;
- результат: `completed`/`superseded` → `finish()` и **один** `done` с полным текстом
  (`superseded` дополнительно `stopped: true`); `aborted` → без событий; `failed`/`unavailable`/
  `timeout` → `error`, никогда `done`;
- `onStart` даёт `status: thinking`, чтобы UI показал «думает», а не «ждёт фоновых агентов».

`acp-backend.ts` перед вызовом делает `keepProcess = mapper.hadBackground && !!followUp` — это
запасное значение, если `settleAcpAnswer` бросит исключение. `finally` остаётся прежним:
`connection.close({ stop: !keepProcess || aborted })`.

### 5.3. Хук OpenCode и границы хода

`acp-programs.ts` объявляет `prepareFollowUp?(sessionId): AcpFollowUp`, где `AcpFollowUp` — это
`{ acceptsUpdates(sessionId, update): boolean; wait(options): Promise<AcpFollowUpResult> }`.

`acp-backend.ts` вызывает `prepareFollowUp` **до** `session/prompt` — baseline фиксируется до
запроса, поэтому быстрый ответ и его `idle` не теряются. Пока идёт `settling`, каждый
`session/update` проходит через `followUp.acceptsUpdates(sourceSession, update)`; `false` отсекает апдейты до маппера.

`packages/server/modules/agents/opencode/sessions.ts`:

- `openCodeStepState(sessionId, after)` читает `session_message` в одной транзакции (`BEGIN`):
  последний `type/seq`, `MAX(seq)` для `idle`, диапазон `user`-сообщений (`firstUser`/`user`) и
  последний assistant после `after`; `interrupted` берётся из assistant, даже если за ним уже
  записан `idle`;
- `user > firstUser` означает, что после собственного сообщения этого хода пришёл ещё один
  человеческий prompt → `superseded`;
- `prepareOpenCodeFollowUp(sessionId)` запоминает baseline до prompt и отдаёт `acceptsUpdates` +
  `wait`; `acceptsUpdates` проверяет БД на первом чанке каждого `messageId` отдельно для
  исходной сессии и inline-ребёнка. Повторные текстовые/мыслительные чанки этого сообщения
  используют уже принятое решение. Структурные апдейты сбрасывают все записи и проверяются
  заново; чанки без `messageId` или исходной сессии всегда читают БД. Watcher продолжает опрос;
  обнаруженный `superseded` запрещает даже ранее принятые сообщения до конца наблюдения.

### 5.4. Watcher шага-продолжения

`watchOpenCodeFollowUp(sessionId, options)` возвращает `AcpFollowUpResult`:

- baseline обязателен; без него — `unavailable` (не «успех»);
- `last !== 'idle' && seq > idle` → шаг идёт, один раз `onStart`;
- `pending > 0` (дети) или идущий шаг сбрасывают quiet-окно;
- завершение: `idle > baseline.idle`, не меньше 3 с тишины **и** не меньше 5 с после перехода
  последнего ребёнка в 0 (`waitingSince`) — отчёт ребёнка может прийти уже после `idle` родителя;
- `state.interrupted` → `failed`; `missing` 3 раза подряд → `unavailable`; 20 минут → `timeout`;
- human prompt → `superseded` (не стримится в старый ответ);
- читатель и тайминги инжектируются для тестов.

### 5.5. Клиент

Клиент уже умел жить после `done`: `turn-events.ts` держит `run`, пока есть hard-held task,
дописывает `text`/`tool` после `done`, `createStreamSaver` сохраняет текст раз в секунду.
Новый сценарий в `packages/client/tests/agent-elapsed.cases.mjs` проверяет важный случай:
ребёнок завершился до окончательного `done`, соединение упало — чат должен переподключиться к
`run-1` и получить продолжение, а не потерять его. `docs/usage.md` описывает новое поведение
для пользователя.

## 6. Как проверить

### Тесты

```bash
vp check --fix packages/server/modules/agents/acp/acp-follow-up.ts \
  packages/server/modules/agents/opencode/sessions.ts \
  packages/server/modules/agents/acp/acp-backend.ts \
  packages/server/tests/acp-follow-up.test.mjs \
  packages/server/tests/opencode-sessions.test.mjs \
  packages/server/tests/acp-events.cases.mjs
vp test run packages/server/tests/acp-follow-up.test.mjs
vp test run packages/server/tests/opencode-sessions.test.mjs
vp test run packages/server/tests/acp-events.cases.mjs
vp test related packages/server/modules/agents/acp/acp-follow-up.ts \
  packages/server/modules/agents/opencode/sessions.ts \
  packages/server/modules/agents/acp/acp-backend.ts
```

Результат на момент передачи (после сценариев, исправленных более сильной моделью): `vp check` —
0 ошибок; `architecture` — ок; `vp test related` по трём файлам — 62 файла, **392 теста**
(1 skipped), все прошли. В трёх профильных файлах — 72 теста:
`acp-follow-up.test.mjs` — один `done` после цепочки, «без фона», `timeout/unavailable/failed` →
`error`, `aborted` без событий, потеря keep-alive видима, второй фоновый ребёнок;
`opencode-sessions.test.mjs` — baseline до prompt, `superseded`, `interrupted` за `idle`,
«продолжение завершилось до первого опроса», лимиты, потеря чтений, пустая схема, второй ребёнок,
кеш владения по `messageId` (300 перемежающихся чанков → 4 чтения), сброс кеша структурными
событиями и потеря владения после `superseded`;
`acp-events.cases.mjs` — hard/soft hold и снятие по notify/idle.

### Ручной сценарий

1. В чате OpenCode попросить: «запусти фонового сабагента, который через 20–30 секунд создаст
   файл, а сам ответь сразу и не жди».
2. Дождаться `end_turn`; в UI — `status.phase=background`, ход ещё `busy`.
3. Дождаться отчёта; в `session_message` родителя должны появиться `synthetic`, затем assistant
   с текстом продолжения и `idle`; в UI текст дописывается в тот же ответ.
4. В trace хода (`~/.local/share/projector/agent/runs/<id>/trace.log`) не должно быть
   `! {"exit":…SIGTERM…}` сразу после отчёта; допустим `! {"exit":…}` только после `IDLE_MS`
   (30 мин) или явного stop.
5. В `session_message` не должно быть assistant с
   `finish=error, error.type=aborted, message=Step interrupted`.

### Быстрый снимок БД

```bash
sqlite3 ~/.local/share/opencode/opencode.db \
  "select seq, type, time_created, substr(data,1,160) from session_message
   where session_id='ses_…' order by seq desc limit 10;"

sqlite3 ~/.local/share/projector/agent/history.sqlite \
  "select id, data from turns where chat='opencode:…' order by rowid desc limit 6;"

sqlite3 ~/.local/share/projector/agent/history.sqlite \
  "select chat, updated, session from chat_index where chat='opencode:…';"
```

Время в `session_message` — epoch ms, в `chat_index.updated` — UTC ISO (`Z`), в логах Vite —
локальное `+05`. Не смешивать.

## 7. Риски и нюансы

- **Границы сообщений вместо временного кеша.** Проверка владения не пропускается для нового
  `messageId`, даже если предыдущее чтение БД было в ту же миллисекунду. Контракт оптимизации:
  новый ответ имеет новый ID, а оставшиеся чанки старого ID принадлежат старому сообщению.
  Структурные и неопознанные события всегда перепроверяются. В двух текущих trace Projector
  (1042 текстовых/мыслительных чанка на момент передачи) `messageId` был у всех; для версий без
  него сохраняется консервативное чтение на каждый чанк. Регрессия с 300 перемежающимися чанками
  трёх источников проверяет четыре чтения состояния (baseline + три сообщения); тесты также
  покрывают смену владельца без задержки, структурные события и запрет старого сообщения после
  `superseded`.
- **Один `done` в конце цепочки.** Пока идёт фон, ход остаётся `busy`, композер отдаёт сообщения
  в очередь. Если продукту нужен ранний «ответ готов, фон отдельно», это отдельное решение:
  вернуть ранний `done` и второй финальный — старый вариант, от которого отказались, потому что
  он терял продолжение при разрыве.
- **Ошибка наблюдения — это ошибка.** Потеря БД, таймаут 20 минут, aborted-шаг и сбой записи
  keep-alive дают `error`, а не «успешный» `done`. Пользователь видит текст, который успел
  прийти, и причину. Не превращать это обратно в тихий успех при доработках.
- **Новое сообщение во время фона.** `superseded` определяется по `user > firstUser`; собственное
  сообщение хода становится `firstUser`. Старый mapper перестаёт принимать апдейты, watcher
  отдаёт `superseded`, ход закрывается как `stopped`. Старый host при этом ещё жив (keep-alive) —
  политика «отменять / ждать / инжектить» остаётся открытой
  ([acp-background-lifecycle](acp-background-lifecycle.md) §D).
- **Permission во время шага-продолжения.** Сокет и `options.approve` живы, запрос доходит до
  страницы (ход ещё `busy`). Если страница закрыта, запрос ждёт до двух часов и отклоняется.
- **Долгий шаг.** Пока шаг идёт, quiet-окно не применяется. Потолок — 20 мин; после него сокет
  закрывается, но keep-alive оставляет процесс.
- **Процесс живёт до 30 мин после последнего события** (`PROJECTOR_AGENT_IDLE_MS`). Это цена
  страховки; при необходимости уменьшать параметр, а не убирать keep-alive.
- **Только hard hold.** Kimi (`hold:false`, soft) не затронут: `hadBackground=false`,
  `followUp` не вызывается. Другие ACP-агенты (Cursor, Codex, Claude Code-ACP) не объявляют
  `prepareFollowUp`; для них поведение прежнее.
- **Старая схема без `session_message`.** `prepareOpenCodeFollowUp` вернёт `unavailable`, и ход
  закроется ошибкой наблюдения, а не тихим успехом. Процесс при этом сохраняется; возможно,
  стоит отдельно отличить «старая схема» от «сбой» в тексте ошибки.

## 8. Открытые вопросы следующему агенту

1. **Измерение стоимости на живом продолжении.** Чтение на каждый идентифицированный текстовый
   чанк устранено (см. §7). Осталось измерить CPU/латентность на длинном реальном запуске;
   версии без `messageId` используют консервативный путь без кеширования.
2. **Политика нового сообщения** при живом фоне/шаге-продолжении (см. §7). `superseded` уже
   отсекает апдейты, но вопрос «второй процесс на ту же нативную сессию» остаётся: отменять фон,
   дожидаться или инжектить сообщение в тот же hosted run.
3. **Один `done` в конце цепочки** — продуктовая проверка: не слишком ли долго ход остаётся
   `busy` при длинном фоне. Если нужен ранний признак «ответ готов», это отдельный протокол, а
   не возврат к двум `done` без защиты от разрыва.
4. **Опция `opencode/child-session-updates`.** OpenCode 2.0.24 объявляет
   `_meta["opencode/child-session-updates"]=true` в `initialize`, но Projector не отправляет
   `clientCapabilities._meta["opencode/child-session-updates"]=true` (видно в trace
   `initialize`, id=1). Если включить, OpenCode начнёт присылать child-статусы отдельными
   `opencode/session/child_update`; текущий диалект рассчитывает на inline
   `_meta["opencode/child-session"]`. Это альтернатива DB-опросу, но требует переработки
   маппера; не делать «заодно».
5. **История чата.** Отдельный дефект: PUT истории может затереть новые ходы старым состоянием
   (см. §9). Нужен revision/ETag или merge на сервере.
6. **Восстановление headless-хода** после рестарта сервера и **ретраи ACP** — незакрытые этапы
   [agent-errors](agent-errors.md) §5 и §6.
7. **Snapshot lock OpenCode** (см. §10) — не причина, но шум и сломанные checkpoint/revert.

## 9. Отдельный след: история перезаписана старым состоянием

Факты:

- `history.sqlite` для чата `…:a7e338e2-…`: последний сохранённый turn — **02:57:05**, всего 18.
- `chat_index.updated` для того же чата — **03:30:50.220 +05**, то есть PUT был уже после ходов
  03:20 и 03:25.
- `recent-runs` знает ход 03:25–03:31 и его `resultPreview`.
- `chats.revision=2371`; `historyRevision()` (`history-store.ts:353-360`) существует, но в PUT
  не участвует.
- `PUT /api/agent/history/:id` (`routes/api/agent.ts:195-210`) вызывает `writeAgentHistory`
  без проверки версии; `writeAgentHistory` (`history-store.ts:240-260`) делает upsert и
  `DELETE FROM turns WHERE chat=? AND id=?` для всех turns, которых нет в payload.
- Клиент (`save-chat.ts`) сериализует сохранения только в пределах одной вкладки
  (`queued`/`saves`), версию не отправляет. Две вкладки/страницы (или Hub) могут перезаписать
  друг друга; устаревшая вкладка со снимком до 02:57 объясняет ровно такую картину.

Чего не хватает для точного виновника: клиентских логов и тела PUT 03:30:50. Гипотезы — вторая
вкладка с тем же чатом, временная демо-страница `quota-demo` (монтировала настоящие компоненты),
или Hub с отставшим состоянием. Все три сходятся в одном: `writeAgentHistory` без версии.

Возможные направления (не реализованы):

- PUT принимает `revision`, сервер сравнивает с `chats.revision` и отвечает `409`; клиент
  перечитывает историю и повторяет/сливает.
- Не удалять отсутствующие turns, а хранить tombstones/пер-turn upsert с `updatedAt`; удаление
  только явной командой. Дороже по схеме.
- Серверный мьютекс/очередь на чат + `If-Match`-подобный заголовок. Не решает «две вкладки
  думают, что они правы», только сериализует.

Любой вариант затрагивает Hub и сохранение при HMR; начинать с теста на две вкладки.

## 10. Шум окружения: stale snapshot lock OpenCode

`~/.local/share/opencode/log/opencode.log` содержит **8861** предупреждений
`failed to capture snapshot`:

```
fatal: Unable to create
'/home/zede/.local/share/opencode/snapshot/3d09166d182018df15c11ce395cefe7507e09e20/
 0a2fb3ac369aaed5fafd9d5e9dff8faf0a23011e/index.lock': Файл существует
```

Файл датирован **2026-11-12 18:34**, то есть заведомо stale. Это ломает snapshot/checkpoint
OpenCode для проекта и добавляет git-спавн на каждом шаге, но к обрыву отношения не имеет.
Перед удалением проверить, что ни один `agent-host`/`opencode` не использует этот snapshot;
удалять только `index.lock`, не каталог.

## 11. Изменённые файлы

| Файл                                                        | Что                                                                  |
| ----------------------------------------------------------- | -------------------------------------------------------------------- |
| `packages/server/modules/agents/acp/acp-follow-up.ts`       | новый: `settleAcpAnswer`, один `done`, keep-alive, ошибки наблюдения |
| `packages/server/modules/agents/acp/acp-prompt.ts`          | вынесен `promptBlocks` (освободить лимит FEOD для backend)           |
| `packages/server/modules/agents/acp/acp-programs.ts`        | `prepareFollowUp`, `AcpFollowUp`, `AcpFollowUpResult`                |
| `packages/server/modules/agents/acp/acp-backend.ts`         | `settling`, `acceptsUpdates`, вызов `settleAcpAnswer`                |
| `packages/server/modules/agents/acp/acp-background-hold.ts` | флаг `held`                                                          |
| `packages/server/modules/agents/acp/acp-events.ts`          | `hadBackground`, `pollBackground`                                    |
| `packages/server/modules/agents/acp/index.ts`               | экспорт типов follow-up                                              |
| `packages/server/modules/agents/opencode/sessions.ts`       | baseline до prompt, `superseded`, watcher с детьми и ошибками        |
| `packages/server/modules/agents/opencode/index.ts`          | `prepareFollowUp`                                                    |
| `packages/server/tests/acp-follow-up.test.mjs`              | один `done`, ошибки, keep-alive, второй ребёнок                      |
| `packages/server/tests/opencode-sessions.test.mjs`          | baseline, `superseded`, `interrupted`, лимиты, потеря чтений         |
| `packages/server/tests/acp-events.cases.mjs`                | hard/soft hold и снятие по notify/idle                               |
| `packages/client/tests/agent-elapsed.cases.mjs`             | сценарий: ребёнок завершился до `done`, reconnect к `run-1`          |
| `docs/usage.md`                                             | раздел «Продолжения OpenCode после фоновых задач»                    |
| `CHANGELOG.md`                                              | пункт в «Исправления»                                                |

Не коммитил: в дереве уже была незавершённая работа по `agent-errors` и квотам. Если коммитить
только этот фикс — перечисленные файлы, не `packages/server/modules/agent/*` из той работы.
