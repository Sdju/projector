# Расход и квоты провайдеров из плагина

## Сейчас

**`PluginCodeApi`** (`packages/server/modules/agents/plugin/code.ts:123-143`) — десять полей:
`version: 1`, `require`, `createAcpBackend`, `acp`, `host`, `features`, `roles`, `widgets`, `mcp`,
`providers`. Последнее — `PluginProviderApi` (`:117-120`) с единственным `registerBalance`; объект собран
в `:281`, проверки — `:205-226`. Публичный `packages/plugin-api/modules/api/index.ts` — только браузерный
API (`languages/panels/tabs/commands/agents`), провайдеров в нём нет.

**`registerBalance`.** Вид объявляется в `projector.contributes.balances`
(`packages/core/modules/plugins/balance.ts:8-17`, allowlist полей `:28-32`), попадает в каталог и в
`PluginCodeLoadOptions` (`code.ts:146-159`), композиция передаёт его в `loadCodeAgents`
(`packages/server/app/agents.ts:99-172`). Вид обязан быть объявлен (`code.ts:209-210`), все объявленные
виды должны быть зарегистрированы (`:300-302`), дубликат бросает «Вид провайдера уже занят»
(`packages/server/modules/providers/balance-registry.ts:41`), встроенные виды зарезервированы
(`balance.ts:19-36`).

Читатель получает `ProviderBalanceContext { id, name, kind, url, apiKey, signal }`
(`balance-registry.ts:3-11`), где `apiKey = balanceApiKey || apiKey` уже расшифрованного провайдера
(`packages/server/modules/providers/balance.ts:228-235`), `signal` — таймаут 10 с. Ответ проходит
`normalizeReading` (`:189-217`), кешируется по `sha256(id,kind,url,key)` с TTL 60/15 с, до 32 записей
(`:18-20,260-277`). `providerBalances()` (`:283-306`) пишет успешные ответы в `provider_samples`
(`packages/server/modules/usage-analytics/providers.ts:37-70`).

**Внутренний расход/квоты.** `ProviderUsage`, `ProviderUsageQuota`, `ProviderUsageContext`,
`ProviderUsageResolver` (`packages/server/modules/providers/usage-registry.ts:3-40`): `read(context)`
возвращает `ProviderUsage { status, period, currency, spend, quotas[], plan, credits, checkedAt, message }`.
Реестр — `Map` + `registerProviderUsage` / `providerUsageResolver(kind)` / `providerUsageKinds()` (`:42-64`).
Вход один — `providerUsage()` (`packages/server/modules/providers/usage.ts:9-21`): провайдер из
`providers.json`, без читателя HTTP 400, таймаут 30 с, **кеша и нормализации нет**. Зарегистрирован только
`qwencloud` (`packages/server/app/provider-usage.ts:1-6`, импорт `packages/server/app/api.ts:72`); его кеш
живёт в модуле (`packages/server/modules/provider-qwencloud/usage.ts:161-168,205-227`), TTL 60/15 с, до 16
записей. Маршрут `GET /api/providers/usage?id=`
(`packages/server/routes/api/providers/usage.ts:6-11`) ничего не пишет в аналитику. Клиент показывает блок,
только если `kind` есть в `usageKinds` (`packages/client/modules/provider/model/store.ts:75-76`,
`ProviderPanel.vue:534-581`, команда `ide.providers.usage.refresh` — `:242-250`).

**Аналитика.** `UsageAnalytics.limits` — снимки лимитов агентов, `providers` — только балансы
(`packages/core/modules/usage-analytics/index.ts:299-323`); истории провайдерских квот нет. Лимиты агентов
плагину уже доступны: `backend.usage = { kind: "function", read(checkedAt) }`
(`packages/server/modules/agent/backend.ts:162-178,238-245`), `/api/agent/usage/<id>`
(`packages/server/routes/api/agent-usage.ts:8-15`), кеш 60/15 с, таймаут 10 с
(`packages/server/modules/agent-usage/index.ts:9-19,66-90,153-171`), запись в `limit_samples`
(`packages/server/modules/usage-analytics/limits.ts:61-81`); так работают Cursor и Claude Code.

**OpenCode-лимиты есть, но агентские:** `GET https://opencode.ai/zen/go/v1/usage` с ключом `opencode-go`
из `$XDG_DATA_HOME/opencode/auth.json` (`packages/server/modules/agents-integration/opencode/client.ts:1-35`,
`credentials.ts:1-40`, `docs/integrations.md:59`) — Go-подписка, не Zen pay-as-you-go.

## Чего не хватает

1. **API.** `registerUsageResolver` нет; `PluginProviderApi` — только баланс (`code.ts:117-120,281`).
   Манифест не знает `usage`: allowlist вкладов `packages/core/modules/plugins/index.ts:249-253`,
   `balances` требует `projector.server` (`:265-274`).
2. **Выбор вида.** Вид плагина появляется только из `contributes.balances`; клиент сливает в список
   видов `balanceKinds`, а не `usageKinds` (`packages/client/modules/provider/model/store.ts:61-73`),
   поэтому вид «только расход» из UI не выбрать (API сохранит — `isProviderKind` проверяет лишь алфавит,
   `providers/kinds.ts:11-16`).
3. **Модель данных.** `ProviderUsage.quotas` — остаток/всего по модели, а не окна времени. У Zen и Z.AI
   квоты — проценты за 5 ч/неделю/месяц; поля `windows` у `ProviderUsage` нет, `limitPeriodSeconds`
   работает только для `AgentUsage` (`core/modules/usage-analytics/index.ts:327-340`).
4. **История.** `/api/providers/usage` не пишется в `agent/analytics.sqlite`; `recordProviderUsage` и таблицы
   нет (grep по `usage-analytics` пуст). Панель истории квот сегодня не на что опереть, а пакетного
   `/api/providers/usages` нет — выйдет N запросов.
5. **Маршруты.** Плагин не может зарегистрировать HTTP-маршрут; браузерная панель читает только
   `/api/providers` и `/api/providers/usage?id=`, а прямой запрос к Z.AI из браузера потребовал бы ключ на странице.
6. **Zen и Z.AI.** Не нашёл: встроенные виды — `custom/local/deepseek/openrouter/qwencloud`
   (`providers/kinds.ts:3-9`), упоминаний `z.ai`, `zai`, `zen` как вида провайдера нет; `dsh-usage-limits`
   в репозитории не найден. Для Z.AI нет ни эндпоинта, ни ключа, ни маппинга — только внешние источники.
7. **Секреты.** Плагину не перечисляются ключи: в контекст баланса попадает только ключ его провайдера
   (`providers/balance.ts:228-235`), браузер видит `hasApiKey: boolean` (`providers/types.ts:34-45`).
   Но серверный плагин — доверенный код в процессе без песочницы (`docs/plugins.md:210`) и технически
   может читать `providers.json`, keyring и env; это не API-доступ, а модель доверия.

## Варианты

**A. `api.providers.registerUsageResolver(...)` — тот же интерфейс, что у встроенных.**
Файлы: `agents/plugin/code.ts` (поле API, дедупликация, общий disposer), `core/modules/plugins`
(`contributes.usage` или флаг в `balances`), `server/modules/plugins` (каталог, диагностика),
`app/agents.ts` (передача/снятие), `providers/usage-registry.ts` (флаг `plugin`), `providers/usage.ts`
(общий кеш), `client/modules/provider/model/store.ts` (слить `usageKinds` в виды),
`packages/server/modules/plugin-api/index.ts` (типы). Плюсы: один контракт с ядром, плагин сам ходит в
Z.AI/Zen своим HTTP/CLI, без нового DSL, переиспользует маршрут и UI. Минусы: нужен серверный код и доверие;
нужна нормализация ответа (сейчас `providerUsage` отдаёт сырой JSON, `normalizeReading` есть только у
баланса); кеш надо поднять в ядро. Безопасность: ключ только своего провайдера, в браузер не попадает;
SSRF не шире, чем у `provider.url` чата; новый риск — форма ответа, лечится нормализатором.
Кеш/офлайн: TTL 60/15 с в ядре, офлайн → `unavailable`. Оценка: 2 дня MVP, +2 дня на историю и аналитику.

**B. Декларативный `usage: { http: {...}, mapping: {...} }` без кода.**
Файлы: `core/modules/plugins` (схема, валидатор), исполнитель в `server`, `providers/usage.ts`, доки/тесты.
Плюсы: пакет остаётся данными, доверие к коду не нужно; ключ подставляет хост, плагин его не видит; JSON
ревьюится. Минусы: `mapping` — новый язык (пути, единицы, проценты, окна, `resetsAt`), его придётся
версионировать; не выражает OAuth, CLI, локальные файлы; ~5–6 дней и поддержка схемы. Безопасность:
https-only, allowlist хоста из декларации, без редиректов, приватные IP запрещены (образец —
`packages/server/modules/media/artifacts.ts:183-218`); SSRF остаётся при произвольном URL, утечка ключа —
если хост подставит его чужому хосту, это и надо запретить. Кеш/офлайн: централизованно.
Тесты: `packages/core/tests/plugins.test.mjs:637-690`, кейсы маппинга и SSRF.

**C. Только ядро, плагину — панель поверх готовых API.**
Файлы: `modules/provider-zai`, `modules/provider-opencode-zen`, `app/provider-usage.ts`, карточка/панель.
Плюсы: без нового API и доверия, быстрее до корректных Z.AI/Zen, ключи в ядре. Минусы: каждый провайдер —
релиз Projector, плагин не может добавить вид, истории нет, панель только читает настроенного провайдера.
Безопасность: лучшая из трёх. Оценка: Zen ~1 день (если endpoint принимает Zen-ключ), Z.AI ~1.5–2 дня,
панель ~1–2 дня.

## Рекомендация и минимальный первый шаг

Делать **A** как общий контракт (он снимает блокер «нельзя плагином»), **C** — как первых потребителей:
Zen/Z.AI не должны ждать внешнего плагина. **B** не делать до изолированного runtime
(`docs/in-process/plugin-agents.md:56-64`): без sandbox декларативность не даёт выигрыша в доверии.
Минимальный первый шаг (~1 день, без UI): в `PluginProviderApi` добавить `registerUsageResolver(resolver)`;
в манифест — декларацию вида (`contributes.balances` с `usage: true` либо `contributes.usage`); прокинуть
её через `PluginCodeLoadOptions` и `applyPluginCatalog`; снимать общим disposer вместе с балансами;
добавить `normalizeUsage` и TTL-кеш в `providers/usage.ts`; слить `usageKinds` в `kindOptions`.
Тесты — по образцу `packages/server/tests/plugin-balance.test.mjs` и `fixtures/balance-plugin/server.cjs`.

**Оценка двух резолверов.** Zen: переиспользовать `goWindows` (`agents-integration/opencode/usage.ts:13-38`)
и `readGoUsage` (`client.ts:1-35`) — ~60–100 строк и ~60 строк тестов; риск: путь `zen/go` и ключ
`opencode-go` принадлежат Go-подписке, публичного usage-эндпоинта и баланса Zen в репозитории нет.
Z.AI: ~150–200 строк и ~80 строк тестов; в репозитории данных нет, по внешним источникам —
`GET /api/monitor/usage/quota/limit` с процентами 5 ч/неделя и единицами `3/6`; риски — регион
(z.ai против open.bigmodel.cn), недокументированный эндпоинт и несовместимость окон с `quotas`.

## Риски и проверки

- **SSRF и ключ.** Для A плагин и так доверенный; для B обязательны https, allowlist хоста, запрет
  приватных IP, `redirect: "error"`, таймаут 10 с — иначе ключ уйдёт на чужой хост. В браузер ключ не
  отдавать никогда (сейчас только `hasApiKey`), не писать в HTML/логи; в ответе разрешать только
  `status/period/spend/quotas/plan/credits/message`.
- **Ответ плагина.** `normalizeUsage` по образцу `normalizeReading`: статус из закрытого списка, суммы —
  десятичные строки, проценты 0–100, длины строк ограничены, лишние поля отброшены.
- **Кеш и HMR.** Кеш — в ядре, не в плагине; регистрация идемпотентна, повторный reconcile не плодит
  читателей; disable/remove снимает всё (сейчас так делает `clearPluginBalances`).
- **Честность.** Нет данных — `unavailable` с причиной, а не нули; различать «ключ отклонён», «нет CLI»,
  «нет плана»; ошибка провайдера не ломает карточку баланса. Провайдер с `kind: "custom"` не получит
  читатель плагина — нужно пересоздание или явное сопоставление, и это надо сказать в UI.
- **Проверки.** `vp test run packages/server/tests/plugin-balance.test.mjs`, кейсы нормализации, SSRF и
  disable, `vp check` по изменённым файлам, затем `vp run check`; GTK и браузерные тесты — только с панелью.

## Открытые вопросы

1. Есть ли у OpenCode Zen (pay-as-you-go) документированный usage/balance-эндпоинт и тот же ли это ключ,
   что `opencode-go` в `auth.json`? Без ответа Zen-резолвер — догадка.
2. Какой хост и формат у Z.AI в регионе пользователя (z.ai / open.bigmodel.cn) и приемлем ли
   недокументированный `/api/monitor/usage/quota/limit` как основа индикатора?
3. Квоты — это окна времени: добавлять `windows` в `ProviderUsage` и рисовать как лимиты агента или
   кодировать в `quotas` с `unit: "%"`?
4. Нужна ли история провайдерских квот в `agent/analytics.sqlite`, или достаточно живого значения по кнопке?
5. Привязывать читатель к отдельному виду или разрешить его для существующего `custom`-провайдера, и
   считать ли A временным решением до изолированного runtime?
