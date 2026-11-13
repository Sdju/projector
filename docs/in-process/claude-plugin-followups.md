# Claude Code после выноса в плагин

Claude Code вынесен в `plugins/claude-code` и больше не регистрируется встроенным
(`server/app/agents.ts`), а его модули, маршрут `/api/claude/usage` и клиентский индикатор удалены.
Ниже — только то, что осталось в общей кодовой базе из-за текущих ограничений plugin API.
Сделанное и контракт описаны в [plugins](../plugins.md) и [architecture](../architecture.md).

## Открытые пункты

- [ ] **Зависимость от Agent SDK остаётся у продукта.** `@anthropic-ai/claude-agent-sdk` есть в
      `package.json`, `packages/server/package.json` и `packages/ide/package.json`. Плагин грузит
      его через `api.require(...)`, потому что установка копирует папку плагина без `npm install`,
      а платформенный бинарник Claude CLI нельзя разумно бандлить. Решить: shared module map,
      установка `dependencies` плагина или отдельный runtime-контракт.
- [ ] **Манифест требует ACP-поля у код-агента.** `packages/core/modules/plugins/agent.ts`
      обязательно ждёт `command`, поэтому в `plugins/claude-code/package.json` есть неиспользуемый
      `"command": "claude"`. Для `projector.server` сделать ACP-поля (`command`, `args`,
      `clientCapabilities`, `terminal`) необязательными или отделить дескриптор код-агента от ACP.
- [ ] **MCP-конвертер Claude-формы живёт в ядре.** `api.mcp.process` — это
      `processMcpConfig` из `packages/server/modules/agent-mcp/index.ts`, а `api.mcp.configs()`
      отдаёт `unknown[]`. Нужно экспортировать тип `McpServerConfig` в plugin API и перенести
      преобразование в плагин.
- [ ] **Нет вклада feature-defaults.** `packages/server/app/features.ts` включает виджеты по
      умолчанию только у `builtin`-агентов. Плагин Claude Code получает их выключенными, хотя до
      выноса они были включены. Добавить в манифест/`AgentBackend` объявление умолчаний возможностей.
- [ ] **Нет клиентских вкладов от серверного плагина.** Из-за этого Claude Code использует общий
      `readTodosPlan`, который не читает `activeForm`, и общий `PluginUsageIndicator` вместо
      прежнего индикатора с окном «Неделя» по умолчанию и командой переключения. Нужен контракт
      client-вкладов для плагина или расширение общего reader'а/индикатора.
- [ ] **Знание о tool-вызовах остаётся в общем ядре.** `packages/client/modules/agent-core/lib/tool-labels.ts`
      и `packages/server/modules/agent/jobs-files.ts` знают `Read`/`Edit`/`TodoWrite` и поля
      `file_path`/`notebook_path`, потому что плагин не может объявить свои подписи и разбор
      затронутых файлов.
- [ ] **Очистка session-env не безусловна.** `CLAUDE_SESSION_ENV` теперь чистится в
      `createClaudeBackend` через `api.host.clearEnv`; если плагин выключен, сервер, запущенный из
      сессии Claude, снова передаёт её переменные терминалам. Нужен startup-hook плагина до
      запуска терминалов или возврат очистки в ядро.

## Осознанные совместимости

Это не следствие plugin API и не планируется к удалению: `.claude/skills`, `.claude/commands` и
`CLAUDE.md` читают роли и штатный агент Projector, а `${NAME}` в `.mcp.json` раскрывается как в
Claude Code. Комментарии и тесты могут упоминать `claude-code` как пример; проверок по имени
бэкенда в общем коде нет.
