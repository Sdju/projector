# ACP: жизнь процесса после `end_turn` (фоновые сабагенты)

Рабочий материал. Факт из сессии Kimi `session_52df80bb…` (2026-11-14): семь `Agent(run_in_background=true)` получили `lost` после `SIGTERM` хоста. Смежная тема UI — [opencode-background-subagents](opencode-background-subagents.md). Хост и ход — [usage](../usage.md), диалекты — [architecture](../architecture.md).

## Что сломано

1. **`agent-host` убивает ACP после ответа.** Когда `session/prompt` вернул результат и сокет сервера закрылся при `turnFinished`, хост шлёт `SIGTERM` (`packages/cli/app/agent-host.ts`). Kimi держит фоновых coder’ов в том же процессе → все `task.terminated` / `lost`.
2. **`acp-backend` закрывает соединение сразу после `end_turn`.** `finally { connection.close() }` завершает hosted-раннер; сокет падает → п.1. Обновления сабагентов после ответа некуда принимать.
3. **Диалект Kimi пустой.** `createKimiDialect` только чистит numbered Read; `Agent` с `status: running` / `automatic_notification` не становится задачей `background: true`. Комментарий «no subagents» устарел.
4. **Контракт чата уже готов.** `settleAnswerTasks`: `running && background && !untracked` переживает `done`. `untracked: true` (как у OpenCode background) на `done` как раз гасит задачу — для Kimi с уведомлениями `untracked` ставить нельзя.

Форма ACP у Kimi (из trace): `tool_call_update` со `status: completed` и текстом вида `task_id` / `status: running` / `agent_id` / `automatic_notification: true` / `resume_hint`. Часто без `title`/`rawInput` на финальном update — разбирать нужно `content`.

## Цель

Фоновый сабагент Kimi (и любой ACP с тем же контрактом) продолжает работу после ответа main, виден в острове как `running`, получает финальный статус из потока, не рестартится с нуля из‑за `SIGTERM`.

## Решение (слои)

### A. Держать ход открытым, пока есть tracked background

`packages/server/modules/agents/acp/acp-backend.ts` + mapper:

- [x] После `stopReason: end_turn` | `cancelled`: как сейчас `mapper.finish()` + `emit("done")`.
- [x] **Не** закрывать connection, пока mapper считает открытыми задачи с `background && !untracked` (`waitBackground`).
- [x] Продолжать `onNotification` → `handleUpdate` (прогресс / конец задач) — сокет жив до конца ожидания.
- [x] Выход: ноль таких задач или `abort`; затем `connection.close()`.
- [ ] Потолок ожидания (отдельный timeout / IDLE) — по желанию, сейчас хватает abort/cancel.

API: `mapper.pendingBackground`, `mapper.waitBackground(signal)`. Без диалекта Kimi (B) счётчик для Kimi остаётся 0 — A готов, эффект на lost появится после B.

### B. Диалект Kimi

`packages/server/modules/agents/kimi/dialect.ts`:

- [x] `call` / `end`: `Agent` + `run_in_background` / результат `status: running`.
- [x] Патч: `background: true`, **без** `untracked`, `hold: false` (завершение — следующий ход).
- [x] Терминальный receipt (`failed` / `completed` / `lost`) сразу снимает задачу — иначе остров «висит» после quota/provider_error.
- [ ] Позже: notification `task.completed` / `failed` / `lost` на следующем ходе → финальный статус.
- [x] Тест в `acp-events.cases.mjs`.

Проверка 2026-11-14 `session_fa6dc3a8…`: 6/7 coder’ов упали с `APIProviderQuotaExhaustedError` (5-hour usage limit), не от SIGTERM; `plugin-version` успел. `notify.enabled: false`.

### C. Хост + detach

Kimi не держит сокет (`hold: false`), поэтому одного A мало: `connection.close()` раньше всегда делал `terminate()`.

- [x] Маркер `keep-alive` в каталоге хода (`acp-keep-alive.ts`).
- [x] `connection.close({ stop: false })` → `detach`, не SIGTERM дерева.
- [x] `agent-host`: при `turnFinished` + keep-alive → `armIdle`, иначе SIGTERM.
- [x] Тест keep-alive в `agent-host.test.mjs`.
- Явный cancel/`terminate` по-прежнему убивает дерево.

### D. Следующее сообщение пользователя

Пока run с background ещё жив (`assistant.run` / recent run):

- не поднимать второй `kimi acp` на ту же нативную сессию (лок / второй `lost`);
- либо инжект в тот же hosted run, либо дождаться фона, либо cancel фона по новой отправке (продуктовый выбор — зафиксировать в usage).

Минимум для первой поставки: A+B так, что один ход не убивает сабагентов; политика очереди сообщений — отдельным пунктом.

### E. OpenCode

Фоновые сабагенты — **hard hold** (не `hold: false`): после `end_turn` тот же ACP нужен для `request_permission` и notify. Soft keep-alive рвал сокет → permissions не доходили в UI. См. [opencode-background-subagents](opencode-background-subagents.md).

## Критерий готовности

- После `end_turn` в trace нет немедленного `! {"exit":…SIGTERM…}` при живых background-задачах.
- Семь `Agent(run_in_background)` доходят до коммитов/финала или честного `error`, а не массового `lost` от хоста.
- В острове задачи `running` с `background: true` после ответа main; финальный статус приходит событием.
- `vp test` на dialect + host; ручной прогон Kimi: один background Agent → ответ main → прогресс → done.
- Обновлены `docs/usage.md` (ход может переживать ответ из‑за фона) и при необходимости `CHANGELOG.md`; этот файл удалить.

## Вне скоупа

- Менять модель «один процесс на ход» для всех агентов без background.
- Lens по дочерней сессии Kimi (отдельный разбор id сессии / `_meta`).
- Чинить только UI без удержания процесса.
