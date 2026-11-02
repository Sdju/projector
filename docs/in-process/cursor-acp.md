# Cursor ACP: оставшееся

P0–P2 сделаны: parameterized-пикер и флаги в общем ACP, кишки Cursor в `server/modules/agents/cursor/` и `src/modules/agents-integration/cursor/`, история без молчаливого `session/new` и без сирот с тем же заголовком, расширения plan/todos/task/image. Контракт — [usage](../usage.md), [архитектура](../architecture.md#агенты-чата-и-их-особенности), [SDK команд](../ide-commands.md).

## Ещё открыто

- Форк ACP: `detached` + последние 10 ходов без инструментов — у Cursor это новый разговор и ещё одна нативная сессия.
- `--trust` при старте `agent acp`: вопрос доверия к workspace с ACP не задать; сейчас остаётся на стороне CLI.
- Подпись «своя / внешняя» модель — только если агент отдаст группы или description; хардкода списка нет.
- Team MCP из кабинета Cursor в ACP не работает (ограничение CLI).
