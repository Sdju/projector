# Серверные маршруты плагинов

## Сейчас (факты из кода, с путями)

**`PluginCodeApi` v1** (`packages/server/modules/agents/plugin/code.ts:123-143`): `version: 1`; `require(specifier): unknown`;
`createAcpBackend`; `acp` (`createPlainDialect`, `extendPlainDialect`, `inputOf`, `isOver`, `readCompaction`, `shorten`, `uuidV7Time`);
`host` (`env`, `clearEnv`, `assertProject`, `attachedImages`, `promptWithHistory`, `registerInjector`, `createReplay`, `sessionListLimit`,
`runHosted`); `features` (`enabled`, `prompt`); `roles.context`; `widgets` (`trustedProject`, `guide`); `mcp` (`configs`, `byNames`,
`ide`); `providers.registerBalance`. Полей `http`, `routes`, `fetch`, `storage`, `secrets`, `dispose` нет; типы реэкспортирует
`packages/server/modules/plugin-api/index.ts`.

**Загрузчик** `loadCodeAgents(entry, hash, options)` (`code.ts:182-315`): CommonJS через `createRequire(import.meta.url)`, кеш
`Map` по `` `${entry}\n${hash}` ``, перед загрузкой `delete requirePlugin.cache[entry]`, фабрика `createPlugin ?? createAgents ?? default`,
`api.require` — `createRequire(entry)` (свой `node_modules`). Снятие — только `clearPluginBalances` для `registerBalanceResolver`;
общего `dispose` нет, старые ключи `loaded` не удаляются.

**Когда исполняется**: `applyPluginCatalog` (`packages/server/app/agents.ts:100-233`) зовёт `loadCodeAgents` для кандидатов из
`packages/server/modules/plugins/index.ts` (фильтр `enabled && trusted && (agents.length || balances.length)`). Старт — `registerBuiltinAgents()`
→ `syncPluginAgents()` → `discoverPlugins()` в `bindRuntime` (`app/plugin.ts:66-78`), далее каждое чтение каталога и `watchPluginDirectory`
(`modules/plugins/watch.ts`, debounce 400 мс). Доверие — `hashPackage`/`isTrusted` (`modules/plugins/trust.ts`): SHA-256 путей,
размеров и байтов.

**Гейт манифеста** (`packages/core/modules/plugins/index.ts:264-270`): `projector.server` допустим только с `contributes.agents`
или `contributes.balances`; ключи `contributes` — `themes, agents, balances, languages, panels, tabs` (249-253). Пакет без агента
и баланса невалиден и независимо от этого не попадает в кандидаты из-за фильтра выше.

**Маршруты**: `RouteDefinition` (`modules/transport/types.ts`) — `method` (строка/массив, `""` для 405), `path`, `handler`. `createRouteDispatcher`
(`transport/router.ts`) один раз на генерацию строит `rou3`-роутер из массива; после создания маршрут не добавить. Массив статичен
— `app/api.ts:76-145`. `handleApi` (`api.ts:146-170`) ждёт `ensureAgentsReady()`, берёт только `pathname.startsWith("/api")`,
зовёт `localOrigin` → `authorizeHttp`, затем `dispatch`, иначе 404; `HttpError` → статус, прочее → 400. `/api` — префикс пути,
mount нет.

**Авторизация**: `authorizeHttp` (`modules/access/http.ts:17-87`) зовёт `accessAllowed(req, false)`; `accessAllowed` (`access/access.ts:96-129`)
требует trusted Host, loopback в режиме `local`, совпадение `Origin` со схемой и Host, LAN-пароль/Bearer. `requireOrigin=true`
запрещает запросы без `Origin` — так работают `POST /api/plugins` и все мутации (`routes/api/plugins.ts:63-95`). Чужие origin
разрешены только gateway `/api/openai/v1`; плагинные пути туда не входят.

**HTTP-сервер**: прод — Node `createServer` (`app/standalone.ts:19-32`); dev/preview — Vite `HttpServer` + middleware `projectorPlugin()`
(`app/dev-plugin.ts`) → `DevRuntime.handle` (`app/dev-runtime.ts:116-124`). HTTPS-сервера нет: `node:https` только как клиент.

**Namespace-прецедент**: `/api/plugins/assets/:key/:hash/**` (`routes/api/plugins.ts:15`) → `openPluginAsset` (`modules/plugins/assets.ts`):
`enabled/trusted`, точный хеш, `isSafePluginPath`, symlink в любом сегменте, MIME, `O_NOFOLLOW`. Других `/api/plugins/...` нет.
Узкие прецеденты: `GET /api/agent/usage/:id` → `readAgentUsageLimits`; баланс провайдера (`ProviderBalanceContext` с `apiKey`
и `AbortSignal.timeout(10_000)`); stdio-MCP `projector-ide` (`agents/ide-mcp/config.ts`).

**Секреты**: странице — только `hasApiKey`/`hasBalanceApiKey` (`providers/provider-normalize.ts`); ключи в keyring (`providerVault`),
а `host.env()` вычитает `PRIVATE_ENV` (`OPENAI_API_KEY`, `DASHSCOPE_API_KEY`, `QWENCLOUD_API_KEY`, `PROVIDERS_SECRET`). Ключ
провайдера плагин получает только в `ProviderBalanceContext.apiKey` для объявленного `contributes.balances`; хранилища, настроек и
`fetch`-прокси нет, `api.require` даёт Node процесса, но не API Projector.

**Тело/отмена**: `readBody(req, maxBytes = Infinity)` (`transport/implementation.ts:10-25`); лимит задаёт только `media.ts` (100
МБ), остальные ~97 вызовов — без лимита. Отмена по `res.on("close")` есть в `agent-lens.ts`, `agent-form-repair.ts`, `agent-answer-repair.ts`;
SSE — `agent-side.ts`.

## Чего не хватает

1. Нельзя объявить HTTP-вклад; `projector.server` без агента/баланса запрещён.
2. Каталог и `PluginCandidate` не несут маршрутов, composition не грузит такой код.
3. Нет живого реестра: диспетчер статичен, плагины грузятся асинхронно; HMR пересобирает его только
   для `packages/server` и `packages/core` (`dev-plugin.ts:29-33`), плагины идут своим путём.
4. Нет общей политики: лимит тела, таймаут, отмена, origin для мутаций, 404/405, конфликты.
5. Браузерный `PluginApi` (`packages/plugin-api/modules/api/index.ts`) не строит URL плагинного
   маршрута; `deviceUrl` внутренний (`client/common/utilities/device-url.ts`), а Hub проксирует
   `/api/devices/<id>/<rest>` → `<rest>` (`packages/hub/modules/gateway/gateway.ts:14`).

## Варианты

### A. Расширение `PluginCodeApi` + декларативный вклад

Манифест `contributes.http: [{ id, methods, path }]` (path от `/api/plugins/<package-key>/`), `server` разрешён при непустом `http`;
код — `api.http.register({ id, handle(ctx) })`, где `ctx`: `req`, `res`, `url`, `method`, `params`, `signal`, `json()`, `readJson(maxBytes)`.
Хост сверяет `id` с манифестом, как `api.agents.register` с `contributes.agents`. Новый `packages/server/modules/plugin-routes`
опрашивается в `handleApi` до 404, поэтому маршруты появляются без перезапуска; reconcile снимает область плагина, как `clearPluginBalances`.

- Плюсы: не создаёт новой границы доверия (код уже в процессе), закрывает webhook/OAuth-callback, переиспользует trust, `pluginPackageKey`
  и диагностику карточки; база для B. Минусы: падение/зависание обработчика в процессе сервера; жизненный цикл при каждом reconcile;
  стриминг отдельно.
- Файлы: `core/modules/plugins/index.ts` (ключи, снятие гейта), новый `core/modules/plugins/http.ts`, `server/modules/plugins/{types,load,index}.ts`
  (`PluginInfo.http`, `PluginCandidate.http`, фильтр, `requiresTrust`), новый `server/modules/plugin-routes/*`, `agents/plugin/code.ts`,
  `app/api.ts`, `app/agents.ts`, `packages/plugin-api`, `client/modules/plugin-runtime/api.ts`, тесты, docs.
- Безопасность: префикс исключает тень `/api/*`; path только относительный, без `..`, `\`, `%2e`, пустых сегментов, `*`/`**`/`:`;
  allowlist методов; для не-GET `accessAllowed(req, true)`; тело 1 МБ; таймаут 10–30 с; `AbortSignal` по `res.on("close")`; ошибка
  без путей и секретов.
- Оценка: 3–5 дней. Тесты: манифест, регистрация/снятие при disable и смене хеша, 404/405/OPTIONS, чужой и пустой Origin, 413,
  таймаут/обрыв, конфликт плагинов, повторный reconcile без дублей, Hub, фикстура install → trust → enable → запрос.

### B. Изолированный процесс/worker + RPC-прокси

Долгоживущий процесс плагина по образцу `app/plugin-runner.ts` и `modules/agent/hosted-process.ts` (`os.tools.spawnAgentHost`,
unix-socket/pipe, JSON-RPC, `attachHosted`); сервер проксирует `/api/plugins/<key>/http/**`, проверяя политику и буферизуя запрос/ответ.

- Плюсы: сбой или зависание плагина не роняет сервер; переживает рестарт и HMR; ступень к «изолированному runtime» из `plugin-concept/concept.md`.
  Минусы: изоляция от сбоев, не по правам (процесс всё ещё доверенный); нет стриминга и точных заголовков; нужен супервизор, handshake,
  версия протокола, политика рестартов.
- Файлы: те же манифест/каталог/`api.http`, плюс `plugin-routes/proxy.ts`, `app/plugin-http-runner.ts`, RPC-контракт, lifecycle
  в `app/agents.ts`/`plugin.ts`, конфиг таймаутов; документация runtime.
- Безопасность: те же проверки на сервере (процессу не отдавать сырой `Host`/`Cookie`), allowlist заголовков, лимит тела до отправки,
  kill по таймауту, запрет своего bind-порта.
- Оценка: 10–15 дней. Тесты: краш посреди запроса → 502, зависание → kill, переподключение после рестарта, disable гасит процесс,
  лимиты тела/ответа, версия RPC.

### C. Без маршрутов: узкие именованные capability

`api.storage` (`plugins/data/<key>`, атомарная запись, 0600), `api.fetch` (исходящий запрос, allowlist origin из манифеста, таймаут,
лимит ответа, запрет redirect в loopback — закрывает CORS), `api.providers.registerUsage` (реестр `registerProviderUsage` уже
есть, плагину не выдан), при нужде `api.secrets.get(name)` в namespace плагина.

- Плюсы: 2–4 дня, минимальная поверхность атаки, не нужен ни реестр, ни супервизор; закрывает кэш, настройки, курсор синхронизации,
  запросы к своему API; ложится на balance/usage/mcp. Минусы: не решает двусторонний HTTP (webhook, OAuth redirect URI, push,
  healthcheck); плагин остаётся клиентом; `api.fetch` требует дисциплины SSRF.
- Файлы: `agents/plugin/code.ts`, новый `plugin-storage`, `plugin-fetch`, экспорт usage-реестра, `plugin-api`, тесты; в манифесте
  — `contributes.network`.
- Безопасность: хранилище только в `plugins/data/<key>` без симлинков и `..`; `fetch` — allowlist схемы/порта/origin, запрет `file:`,
  приватных диапазонов и редиректов; секреты — свой namespace.
- Оценка: 2–4 дня. Тесты: атомарность и 0600, параллельная запись, лимиты; `fetch` с редиректом, таймаутом, большим телом, приватным
  адресом; `registerUsage` и снятие при disable.

## Рекомендация и минимальный первый шаг

Делать A и сразу добавить `api.fetch`/`api.storage` из C как ортогональные capability: код `projector.server` уже исполняется
в процессе сервера с его правами, поэтому A не повышает доверие, а даёт контролируемую точку входа; B оправдан только с реальной
песочницей, иначе это дорогая изоляция от сбоев. Реестр маршрутов из A — предпосылка для B.

Первый шаг (1–2 дня, отдельный PR): снять гейт манифеста и добавить `contributes.http` с валидацией; добавить `http` в `PluginInfo`/`PluginCandidate`
и фильтр кандидатов; завести `server/modules/plugin-routes` с префиксом `/api/plugins/<key>/` и вызовом из `handleApi`; выдать
`api.http.register`; фикстура и тест «install → trust → enable → GET/POST → disable → 404». Затем — `api.httpUrl` в браузерном
API (иначе Hub-страница попадёт в свой маршрут, а не в device) и docs.

## Риски и проверки

- Path traversal: тот же класс проверок, что `isSafePluginPath`, плюс запрет `%`, `\`, `..` после однократного декодирования (как
  `plugins.ts:23-27`), иначе `<key>/../../agent` выйдет за префикс.
- Конфликты: одинаковый `id`/путь у двух плагинов, пересечение со штатным маршрутом, `GET` vs `""`, завершающий `/`; нужна диагностика
  и детерминированное «первый выигрывает»; `**` не разрешать.
- Лимиты и таймауты: тело 1 МБ по умолчанию (сейчас `readBody` без лимита), allowlist заголовков ответа, лимит размера ответа;
  `AbortSignal.timeout` + `res.on("close")`; синхронный throw ловит `handleApi`, «висящий» промис — нет; JSON не должен содержать
  абсолютных путей, ключей и стеков (сейчас `handleApi` отдаёт `error.message` как есть).
- Hot-reload: фабрика вызывается на каждый `discoverPlugins`, поэтому регистрация обязана быть идемпотентной (ключ `plugin + hash + route id`)
  и сниматься в scope; реестр должен переживать генерацию (`globalThis`, как `projectorPluginWatch`), иначе дубли и утечка обработчиков.
  Рестарт сервера строит реестр заново из каталога, персистентных обработчиков нет (в отличие от B).
- Доверие: endpoint доступен любому коду страницы и локальным процессам, прошедшим `accessAllowed`; это не новая утечка, но маршрут
  становится контрактом — нужен `apiVersion` и диагностика.
- Проверки: `vp test run tests/... -t ...`; браузерный сценарий — `packages/client/tests/plugins-ui.test.mjs` (сейчас не покрывает
  trust/enable/чат).

## Открытые вопросы

- Префикс `/api/plugins/<package-key>/` (рядом с assets) или `/api/plugin/<id>/`?
- Разрешать ли path-параметры и `**`, или в первой версии только статические сегменты?
- Считать ли маршрут достаточным вкладом для `server` или требовать ещё declarative-вклад?
- Нужен ли стриминг (SSE) в A или это признак, что нужен B?
- `api.secrets`/`api.storage` — в `apiVersion: 1` или поднимать до 2, и кто владеет таймаутом?
