# Фоновые сабагенты OpenCode

Рабочий материал. Связано с [acp-background-lifecycle](acp-background-lifecycle.md) и UI Lens — [agent-lens.md](../agent-lens.md).

## Факт из сессии `a5f7310ac7ae` (2026-11-15)

Три `subagent` с `rawInput.background: true` вернули текст:

`The subagent is working in the background (sessionID: ses_…). You will be notified…`

Дочерние сессии продолжали слать `session/update` с `_meta["opencode/child-session"]` до `stopReason: end_turn`, затем процесс вышел с кодом 130 (убийство хоста). `keep-alive` не писался.

## Причины

1. **`dialect.end` не разбирал prose-receipt** — только JSON `{"sessionID","status":"running"}`. Задача закрывалась как `done` без `session` / `background`.
2. **JSON-путь ставил `untracked: true`** — soft keep-alive и `settleAnswerTasks` не держали процесс и строку задачи.
3. Хост после `end_turn` + `connection.close()` слал SIGTERM дереву OpenCode → обрыв детей.

## Сделано

- [x] Разбор prose `sessionID: ses_…` и JSON.
- [x] Патч: `background: true`, `hold: false`, **без** `untracked`; `session` из receipt.
- [x] Старт с `rawInput.background: true` сразу помечает soft hold.
- [x] Тест в `acp-events.cases.mjs`.
- [ ] Уведомление о завершении ребёнка → финальный статус задачи (следующий ход / notification).
- [ ] Lens по `task.session` для фонового сабагента (после появления session в патче уже возможно).

## Критерий

- После `end_turn` в trace нет немедленного `! {"exit":…}` при живых background-сабагентах (есть `keep-alive`, host → `armIdle`).
- В острове задача `running` с `session`, а не мгновенный `done`.
