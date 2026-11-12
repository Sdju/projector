# @projector/cursor-agent

Плагин Projector, который добавляет агента Cursor через ACP (`agent acp`). Манифест объявляет
агента и SVG-иконку кнопки «+» (`icons/cursor.svg`), а `dist/server.cjs` — доверенный серверный
код: он собирает `AcpProgram` Cursor с его диалектом, расширениями (`ask_question`,
`create_plan`, `update_todos`, `task`, `generate_image`), нормализацией выбора модели,
`backend.plan.tools` для острова задач и клиентскими возможностями параметризованного пикера.
Там же живут лимиты подписки и токенная аналитика: `backend.usage` читает ConnectRPC и
`auth.json` Cursor, `usageWindows` задаёт окна «Всего / Авто / API», а `backend.usageLog`
забирает журнал событий дашборда (`get-filtered-usage-events`) — локальные транскрипты токенов
не пишут. Встроенного маршрута `/api/cursor/usage` больше нет — Projector отдаёт лимиты через
`/api/agent/usage/cursor`, пока плагин включён.

## Сборка

```bash
vp run build:plugin:cursor
```

Скрипт запускает `vp build --config plugins/cursor/vite.config.ts` и пишет
`plugins/cursor/dist/server.cjs`. Исходники импортируют типы сервера только через
`src/api.ts`; в собранном модуле нет runtime-импортов `@ai-projector/*`, поэтому файл можно
загрузить в процесс сервера как есть.

## Установка

Положите каталог `plugins/cursor` (с собранным `dist/server.cjs`) в каталог плагинов Projector,
включите плагин и подтвердите доверие к серверному коду. Без доверия код не выполняется.

## Проверка

```bash
PROJECTOR_TEST_CURSOR=1 vp test run plugins/cursor/tests/live.test.mjs
```

Тест собирает плагин, устанавливает его во временный data-dir, подтверждает доверие, включает,
запускает настоящий `agent acp` и проверяет ACP handshake. Без переменной окружения тест
пропускается, потому что зависит от установленного Cursor CLI и авторизации.
