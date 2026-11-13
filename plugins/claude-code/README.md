# @projector/claude-code-agent

Плагин Projector, который добавляет агента Claude Code через Anthropic Agent SDK. Раньше бэкенд,
лимиты и клиентский индикатор жили в основном продукте; теперь всё это в пакете, а в ядре остаются
только общие контракты и доверенный загрузчик.

`dist/server.cjs` экспортирует `createAgents(api)` и возвращает произвольный `AgentBackend`:

- ход через SDK (`query`), поток текста, «мысли», вызовы инструментов, субагенты и фоновые задачи;
- история сессий, переименование, закрепление и удаление;
- откат файлов по `messageId` и ветвление нативной сессии по `tail`;
- permission modes, model/effort/budget/steps, `AskUserQuestion`;
- лимиты подписки (окна «Неделя / 5 часов») через общий `/api/agent/usage/claude-code`;
- `backend.plan.tools = ["TodoWrite"]` для острова задач;
- hosted-ход в отдельном процессе через `api.host.runHosted` и общий `app/plugin-runner.ts`.

Agent SDK не копируется в bundle: плагин берёт его из зависимостей сервера через
`api.require("@anthropic-ai/claude-agent-sdk")`, поэтому платформенный бинарник Claude CLI
продолжает работать. `api.host` даёт среду без секретов Projector, вложения, историю, injector,
replay и hosted-ход; `api.features`, `api.roles`, `api.widgets` и `api.mcp` — то же, что получали
встроенные агенты.

## Сборка

```bash
vp run build:plugin:claude-code
```

Скрипт пишет `plugins/claude-code/dist/server.cjs`. Исходники импортируют типы сервера только
через `src/api.ts`, поэтому в собранном модуле нет runtime-импортов `@ai-projector/*`.

## Установка

Положите каталог `plugins/claude-code` (с собранным `dist/server.cjs`) в каталог плагинов
Projector, включите плагин и подтвердите доверие к серверному коду. Без доверия код не
выполняется. CLI `claude` должен быть установлен и авторизован.

## Проверка

```bash
vp test run plugins/claude-code/tests/plugin.test.mjs
```

Тест собирает плагин, устанавливает его во временный data-dir, подтверждает доверие, включает и
проверяет бэкенд, иконку, лимиты, план и снятие агента при выключении.
