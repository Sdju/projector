# Поставка и доверие плагинов

Рабочий документ. Текущие контракты — [plugins.md](../plugins.md), поставка продукта — [distribution.md](../distribution.md), незакрытые пункты — [delivery.md](delivery.md), [npm-release.md](npm-release.md), концепт — [plugin-concept/concept.md](plugin-concept/concept.md). Код не менялся, тесты не запускались.

## Сейчас

**Установка.** `POST /api/plugins` (`packages/server/routes/api/plugins.ts`) принимает действия `refresh | enable | disable | install | trust | remove`; изменяющие требуют `accessAllowed(req, true)`, каталог отдаётся только странице Projector. `install` → `installPlugin(body.path)` (`packages/server/modules/plugins/index.ts`): `realpath(resolve(path))` принимает **любую локальную папку** (абсолютную или относительно cwd сервера), требует каталог, валидирует манифест, читает все объявленные entry через `loadPluginPackage`, отклоняет пакет при любой диагностике, затем `destinationFor` + `copyPackage` + `updateState`.

- `destinationFor` (`install.ts`) кладёт пакет в `plugins/packages/<name>/<version>/` (scoped → `@scope/name/version`) и проверяет, что путь не выходит из `packages/`.
- `copyPackage` (`install.ts`) рекурсивно копирует **только обычные файлы и папки**, бросает на симлинке, пропускает `node_modules`, если внутри есть симлинки (pnpm-workspace), пишет через `writeFile(..., {flag:"wx"})`.
- Дубликат `name@version` отклоняется lstat-проверкой до копирования; при ошибке копирования каталог удаляется best-effort (`rm`), кроме `EEXIST`.
- Ограничений на суммарный размер пакета и число файлов нет; `readdir` не сортируется, `fsync` нет → копирование не атомарно и при падении может оставить частичный каталог с валидным `package.json`.
- Discovery (`directoriesAt`, `managedCandidates`, `directCandidates`) не заходит в симлинки, не сканирует `packages`/`data` как прямые папки. Дубликаты `name@version`, отсутствующая выбранная версия → `status: "error"`; запись в `plugins.json` без пакета → `missing`.
- `enable` запрещён для `missing`, для `error` и без доверия (`setPluginEnabled`). `remove` удаляет только управляемую установку под `packages/`, ручную папку не трогает (`removePlugin`).
- Тема-онли пакет включается сразу и **не требует доверия вовсе**: его JSON перечитывается на каждом discovery и применяется без подтверждения.

**Модель доверия.** `hashPackage` (`packages/server/modules/plugins/trust.ts`) считает SHA-256 по дереву: обход отсортирован `localeCompare`, на каждый обычный файл подаётся `<relative-path>\0<size>\0` + байты; каталоги участвуют только префиксом, пустые каталоги и права/mtime не входят, симлинк — исключение. Хеш **включает `node_modules`**, если он есть. Хранится в `$XDG_DATA_HOME/projector/plugins.json` как `plugins.<id>.trustedHash` (`state.ts`), файл пишется атомарно с режимом `0600` (`atomic-files/index.ts`). Доверие требуется, если есть `agents`, `balances`, `projector.server` или `projector.browser` (`requiresTrust` в `discoverPlugins`); сравнение — точное равенство `stored === current` (`isTrusted`). Хеш пересчитывается на каждый `GET /api/plugins` и на каждый проход watcher'а (`watch.ts`, рекурсивный `fs.watch`, дебаунс 400 мс), то есть на пакете с `node_modules` это дорого.

- Снятие доверия: любое изменение файла → другой хеш → `trusted: false`, код выгружается (`applyPluginCatalog` пропускает не-enabled/не-trusted), в «Работы → Доверие» создаётся уведомление `syncPluginTrustNotices` со ссылкой `/settings?section=plugins`.
- Пользователь видит в карточке (`PluginSettings.vue`) текст «доверенный код не изолирован», кнопки «Подтвердить доверие»/«Удалить», путь пакета и зависимости, но **не видит ни хеша, ни источника, ни diff**; хеш доступен только через API/`ide.plugins.list`.
- Подписи, published-hash, ключей и внешнего списка отзыва нет: `sigstore`, `gpg`, `minisign` в коде отсутствуют. `trustPlugin` перед хешированием ставит зависимости (`ensurePluginDependencies`), поэтому подтверждение доверия одновременно запускает `npm install`.

**Зависимости плагина.** `deps.ts`: `npm install --omit=dev --ignore-scripts --no-bin-links --no-audit --no-fund --package-lock=false` в каталоге пакета, таймаут 120 с, штамп `node_modules/.projector-deps.json`; lock-файла и проверки integrity нет, диапазоны версий «плывут», в доверенный хеш попадает случай результата. Офлайн-тест ожидает явную ошибку (`plugin-deps.test.mjs`).

**Формат пакета.** `validatePluginManifest` (`packages/core/modules/plugins/index.ts`): allowlist верхних полей `name, version, description, private, type, engines, dependencies, optionalDependencies, projector`; `projector.apiVersion === 1`; allowlist вкладов `themes, agents, balances, languages, panels, tabs`; неизвестные поля и неизвестные вклады отклоняются. Версия — semver-regex плюс собственный `compareSemver`/`satisfiesProjectorRange`; зависимости `semver`, `tar`, `pacote`, `ssri` в catalog `pnpm-workspace.yaml` отсутствуют. Совместимость — только `engines.projector` (в `engines` разрешён лишь ключ `projector`); при нечитаемой версии Projector проверка молча пропускается с предупреждением в лог (`version.ts`). `private: true` разрешён и игнорируется, поэтому примеры `plugins/cursor`, `plugins/claude-code`, `plugins/example-ui` проходят валидацию, но не публикуемы в npm как есть.

**Существующие каналы.** `@ai-projector/ide|native|hub` публикуются через OIDC trusted publishing с provenance (`.github/workflows/publish.yml`, `docs/distribution.md`); версия 0.13.0 выпущена 15.11.2026. `files` пакета IDE — `bin, dist, packages, resources, scripts/postinstall.mjs, LICENSE, README.md` (`packages/ide/package.json`), **папки `plugins/` там нет**: пользователь npm-пакета не может получить Cursor/Claude Code без checkout, сборки и ручного копирования. `@ai-projector/plugin-api` — `private: true` (`packages/plugin-api/package.json`), типов автора в npm нет. `projector-install-desktop` (`packages/cli/app/install-desktop.js` → `packages/core/modules/os/modules/*/install-desktop.ts`) только создаёт ярлык. Автообновления приложения нет — открытый пункт `delivery.md`.

**Переиспользуемое.** Захардённая загрузка файла: `packages/server/modules/media/artifacts.ts` (`download`) — HTTPS-only, `redirect:"error"`, таймаут, лимит размера, запись `0600`; годится как шаблон, но это не общий модуль. Безопасный `git clone` есть в `packages/server/modules/git-import/clone.ts` (`core.hooksPath=/dev/null`, `http.followRedirects=false`, askpass). Атомарная запись и блокировки — `atomic-files/index.ts`. Реестра npm, tar-распаковки, semver-библиотеки и клиента реестра в репозитории **нет**.

## Чего не хватает

- Нет источника установки: `StoredPluginState` хранит только `enabled`, `version`, `trustedHash` — отличить «из папки» от «из реестра» и проверить, что на диске лежит именно опубликованный артефакт, нечем.
- Нет действия «обновить»: установка другой версии целиком перезаписывает запись состояния (`updateState(..., {enabled, version})` в `installPlugin`) — прежний `trustedHash` стирается, пакет с кодом принудительно становится `enabled: false`, старая версия остаётся мусором на диске, отката нет.
- Нет каталога: UI ищет только по локальным пакетам (`model.ts`, `filtered`), пустое состояние — «Плагины не установлены»; `catalog.json`, GitHub-release-артефактов плагинов и списка отзыва не существует.
- Нет целостности «до установки»: хеш считается по уже распакованному каталогу, сверить с опубликованным нечем; нет подписей и provenance-проверки для плагинов.
- Нет отзыва: отозвать доверие может только изменение файлов на диске; глобального «версия X скомпрометирована» нет, уже исполненный JS не отзывается (это же зафиксировано в `plugins.md`).
- Нет авторизации в приватных реестрах, кеша офлайн и политики автообновления.

## Варианты

### A. npm как транспорт

`npm pack`/registry metadata + tarball, установка в `plugins/packages/<id>/<version>/`, integrity из `dist.integrity`, staged install + rollback.

- Файлы: новый `packages/server/modules/plugins/registry.ts` (metadata, version pick), `tarball.ts` (распаковка с защитой от tar-slip/симлинков/абсолютных путей), изменения `install.ts`/`index.ts`/`state.ts` (`source`, `integrity`), действие `install-registry`/`update` в `routes/api/plugins.ts`, поле «имя@версия» в `model.ts` + `PluginSettings.vue`, IDE-команда `ide.plugins.install.registry`.
- Плюсы: привычная авторизация npm, версии и dist-tags бесплатно, `dist.integrity` (sha512) и provenance, scoped-имена и приватные реестры через существующий `.npmrc`, ноль своей инфраструктуры.
- Минусы: сеть обязательна; typosquatting (`@projector/...` против `@ai-projector/...`); dependency confusion в `dependencies` (внутренний `npm install` идёт с конфигом пользователя); нужен свой tar-экстрактор или tar-библиотека в catalog; npm CLI как зависимость уже есть в `deps.ts`, но вызов `npm pack` добавляет второй режим.
- Безопасность: lifecycle-скрипты пакета не запускаются вообще (сейчас код не вызывает `install`), `--ignore-scripts` уже норма для зависимостей; compromised tarball ловится integrity, но integrity берётся из того же реестра — без проверки подписи/provenance это защита от порчи, не от подмены; распаковка обязана отклонять `..`, абсолютные пути, симлинки, hardlink, устройства и превышение лимитов.
- UX: установка по `name@version`, обновление = новая версия + повторное доверие (иначе «тихое обновление доверенного кода»); отзыв — удаление версии из каталога и принудительный `disable` по списку.
- Офлайн: нет (явная ошибка + кеш tarball при желании). Приватные пакеты: да, через `.npmrc` (нужен UI-объяснение). Оценка: **6–8 дней**.
- Тесты: стаб-реестр с фикстурным `.tgz`, битый integrity, `..`/symlink/absolute entry, лимит размера, staged rollback при падении распаковки, офлайн, повторная установка версии, пересчёт trust-хеша и снятие доверия.

### B. Собственный curated-каталог

`catalog.json` в репозитории/на CDN + ручная модерация, tarball'ы на GitHub Releases, sha256 в каталоге.

- Файлы: `scripts/distribution/plugins.mjs` (генерация каталога из релизов), `catalog.json` (id, version, description, `projector.apiVersion`, `engines.projector`, tarball URL, sha256, размер, дата, статус), `packages/server/modules/plugins/catalog.ts`, `client/modules/plugins` (список/детали/установка), `docs/plugins-catalog.md` (правила модерации).
- Плюсы: лучший контроль от typosquatting и dependency confusion (белый список), можно публиковать готовые `plugins/cursor`/`plugins/claude-code`, отзыв = удаление записи + `blocked` версии, не нужен npm-аккаунт у автора.
- Минусы: нужна инфраструктура и человек-модератор; своя проверка хеша опубликованного tarball; GitHub Releases как CDN не гарантирует неизменность (нужна фиксация sha256 в каталоге, подпись каталога желательна).
- Безопасность: сильнее A по подмене имён, слабее по автоматизации; каталог сам становится точкой атаки (нужен HTTPS + пиннинг, лучше подпись); postinstall не запускается by design.
- UX: браузер каталога, «Установить», «Обновить до 1.2.0», «Отозвано, выключено»; офлайн — каталог кешируется, установка нет. Приватные пакеты — только через отдельный/корпоративный каталог. Оценка: **+5–7 дней** к A.
- Тесты: генерация каталога из фикстур, несовпадение sha256, запись без tarball, `blocked`-версия выключает пакет, каталог недоступен → локальные плагины работают.

### C. Git-источники

Установка из `https://host/repo#<tag|sha>` c фиксацией коммита.

- Файлы: `packages/server/modules/plugins/git.ts` (на базе `git-import/clone.ts`), действие `install-git`, поле URL/ref в UI.
- Плюсы: минимум инфраструктуры, работает для приватных репозиториев по токену, версия = коммит, легко запинить.
- Минусы: нет версий/dist-tags/метаданных, нужен `git` на машине, репозиторий может содержать что угодно (нужны те же проверки tar-slip/симлинков), нет каталога и отзыва, авторы должны собирать `dist` в репозитории.
- Безопасность: пиннинг на sha защищает от force-push, но не от скомпрометированного аккаунта; сабмодули и LFS нужно запретить; `core.hooksPath`/redirects уже отключены в существующем clone.
- UX: «вставь URL и коммит» — разработческий, не массовый; офлайн нет. Оценка: **4–6 дней** для MVP без каталога.
- Тесты: клон в staging, отказ при грязном дереве/сабмодулях, симлинк в репозитории, неверный ref, таймаут, офлайн.

### D. Остаться «только локальная папка»

- Плюсы: 0 дней, минимальная поверхность атаки, соответствует текущей формулировке «библиотека, а не магазин» (`concept.md`).
- Минусы (продуктовые): npm-пользователь не получает Cursor/Claude Code вообще (их нет в tarball IDE); каждое обновление — ручное копирование и повторное доверие; нет обнаружения, версий и отзыва; «hub-ru-подобный магазин» невозможен без пересмотра модели поставки; поддержка отвечает «соберите из checkout».
- Когда годится: если целевая аудитория — только разработчики самого Projector и число плагинов < 5.

## Рекомендация и минимальный первый шаг

Брать **A как транспорт**, **B как слой метаданных позже** (каталог — это отдельное решение о модерации, а не порт плагина). Первый шаг без каталога и без автообновления: установка по `name@version` из npm с integrity, staged install и rollback.

Этапы первого шага (6–8 дней):

1. `registry.ts`: metadata по имени, выбор точной версии, `dist.tarball` + `dist.integrity`, таймауты, лимиты, внятные ошибки (1–1,5 дня).
2. `tarball.ts`: распаковка в `plugins/.staging/<uuid>`, запрет `..`, абсолютных путей, симлинков/hardlink/устройств, лимит байт и числа файлов, проверка sha512 до распаковки (1–1,5 дня).
3. Staged install в `index.ts`: валидация манифеста уже распакованного дерева, `fsync`, `rename` в `packages/<id>/<version>`, удаление staging при любой ошибке; старую версию не трогать (1 день).
4. `state.ts` + API: поля `source: "registry"`, `integrity`, `requested`, действие `install-registry`; доверие остаётся обязательным и привязано к паре (integrity, treeHash) (1 день).
5. UI/IDE-команда: поле «имя@версия», прогресс, диагностика, текст «код из npm, требуется доверие»; хеш и источник показывать в карточке (1 день).
6. Тесты и документация: фикстурный реестр, вредоносные архивы, rollback, офлайн, обновление `plugins.md` (1,5–2 дня).

Явно **не** входит: автообновление, каталог, подписи, приватные реестры в UI, отзыв. Это следующие 5–7 дней (B) и отдельное решение про ключи.

## Риски и проверки

- Доверие сейчас отвечает на вопрос «эти байты на диске те же, что я подтверждал», а не «это опубликовал автор». После A нужно хранить кортеж (источник, версия, integrity, treeHash) и показывать его; иначе обновление из реестра выглядит как обычное подтверждение хеша.
- Обновление доверенного кода нельзя делать молча: текущая семантика «любое изменение → снять доверие» должна сохраниться, иначе `plugins.json`-модель теряет смысл.
- `hashPackage` на пакете с `node_modules` считается на каждый discovery и на каждый проход watcher'а — при обновлениях и каталоге это станет заметно; нужен кеш по (path, mtime, size) или хеш, зафиксированный при установке.
- Тема-онли пакеты включаются без доверия; при сетевой поставке это канал доставки данных без подтверждения (токены применяются сразу). Решить до каталога.
- Распаковка архива — новый класс атак (tar-slip, симлинк-побег, zip-bomb, hardlink на `/etc/shadow`); нужны лимиты байт/файлов/глубины и `O_NOFOLLOW`.
- Внутренний `npm install` зависимостей плагина остаётся слабым звеном: без lock-файла и integrity; минимум — `--ignore-scripts` (есть), `--registry` из явного конфига, фиксация результата в state.
- Проверки: `vp test related packages/server/modules/plugins/index.ts`, новые тесты рядом с `packages/server/tests/plugins.test.mjs`; регрессии — `plugin-deps.test.mjs`, `plugin-browser-assets.test.mjs`, `packages/client/tests/plugins-ui.test.mjs`; установка production-пакета в отдельный `XDG_DATA_HOME` без install-скриптов (уже в чек-листе `concept.md`).
- После изменения UI — реальное взаимодействие: фокус, drag, контекстное меню, IME, восстановление терминала (`AGENTS.md`).

## Открытые вопросы

1. Транспорт: registry HTTP + своя распаковка (нужна tar-библиотека в catalog) или `npm pack` как процесс (меньше кода, больше зависимости от npm CLI и его конфига)?
2. Кто подписывает: достаточно provenance npm (OIDC) или нужен собственный ключ/minisign для каталога и tarball'ов?
3. Каталог: `catalog.json` в этом репозитории, отдельный сайт или GitHub Releases? Кто модерирует и сколько это часов в неделю?
4. Политика обновлений: только ручное подтверждение, «уведомлять и обновлять по кнопке» или автообновление для theme-only пакетов?
5. Нужны ли приватные реестры и корпоративные каталоги в первой версии, и как вводить токен (сейчас секреты живут в `integration-store`)?
6. Требовать ли доверие для theme-only пакетов после появления сетевой установки?
7. Что считать отзывом: удаление версии из каталога, принудительный `disable` по списку `blocked` или и то и другое; как отзывать уже исполненный браузерный код (сейчас — только перезагрузка/выгрузка)?
