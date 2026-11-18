# Фоновые сабагенты OpenCode

Рабочий материал. См. [фоновые сабагенты Kimi](../usage.md#фоновые-сабагенты-kimi) и [UI Lens](../agent-lens.md).

## Факты

### `a5f7310ac7ae` (до фикса)

Три `subagent` с `background: true` → prose receipt `sessionID: ses_…`. Диалект не разбирал текст → задача `done` без session. После `end_turn` процесс `exit 130`.

### `94e7d49f2853` (после soft keep-alive)

- Keep-alive файл появился (~01:57), процесс прожил до idle (~02:27, `PROJECTOR_AGENT_IDLE_MS` = 30 мин) → снова `exit 130`.
- После `end_turn` дети ещё слали `session/request_permission` (L938), затем `$/cancel_request`.
- Soft close рвёт ACP: approvals после ответа родителя некуда отвечать; idle SIGTERM убивает долгий фон.

OpenCode держит детей на **том же** соединении (stream + permissions + notify), в отличие от Kimi (completion — следующий ход).

## Сделано

- [x] Разбор prose/JSON `sessionID`.
- [x] Патч: `background: true`, **без** `untracked`, **hard hold** (не `hold: false`).
- [x] Notify `<subagent sessionID state=completed|failed|error|cancelled>` снимает hold (если придёт по ACP).
- [x] `poll` + `idle_outcome` в БД OpenCode: notify часто только во внутренний следующий ход, не на ACP-wire — иначе задачи вечно `running`.
- [x] При `readAgentHistory` для `opencode:*` — settle уже сохранённых `running` по `idle_outcome` (иначе после reload вкладки они снова «активны»).
- [x] `acp-backend`: при `pendingBackground > 0` после `done` — `status.phase=background`, сокет жив до `waitBackground`.
- [x] Клиент: после `done` не сбрасывает `run`, пока есть hard-held tasks → permissions/rejoin на том же стриме.
- [x] Host: при keep-alive без клиента каждый stdout сбрасывает idle (страховка для soft-пути Kimi).
- [x] Тесты hard hold + notify / keep-run в `acp-events.cases.mjs` и `agent-elapsed.cases.mjs`.

## Критерий

- После `end_turn` connection не закрывается, пока pending background > 0.
- Permission детей после ответа родителя обрабатываются.
- Нет idle SIGTERM на активном фоне с открытым сокетом.
