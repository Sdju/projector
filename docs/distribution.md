# IDE, нативная палитра и Hub

Исходники остаются в одном pnpm workspace. Для установки на другую машину собираются три публичных npm-пакета:

| Пакет                  | Содержимое                                             | Требования                                                                     |
| ---------------------- | ------------------------------------------------------ | ------------------------------------------------------------------------------ |
| `@ai-projector/ide`    | Сервер, готовый веб-интерфейс, CLI, терминалы и агенты | Node.js 24.11–24.x; Python, make и C++ compiler для сборки `node-pty` на Linux |
| `@ai-projector/native` | GTK-палитра и каталог приложений GIO                   | IDE той же версии, GTK4, GObject Introspection и зависимости сборки `node-gtk` |
| `@ai-projector/hub`    | Общий веб-origin Hub и туннели к устройствам с IDE     | Node.js 24.11–24.x; не требует GTK или сборочного окружения                    |

Публикуемые пакеты лежат в workspace: `packages/ide`, `packages/native` и `packages/hub`. Их манифесты, README и `bin`/`exports` статические, а собранное печатается рядом и целиком игнорируется git: `dist/`, `packages/`, `resources/`, `bin/`, `LICENSE`. Сборка каждого пакета живёт в `packages/<name>/scripts/build.mjs`, а `vp run build:distribution` запускает их по порядку после `vp run build`. Внутренние `@ai-projector/client`, `server`, `core` и `cli` остаются `private` и копируются внутрь IDE при сборке.

## Установка из npm

```bash
# Только IDE — GTK, vio и Vite не устанавливаются.
npm install -g @ai-projector/ide
projector --browser

# Необязательное дополнение — в тот же npm prefix.
npm install -g @ai-projector/native
projector --native

# Отдельный Hub — можно поставить на другую машину или VPS.
npm install -g @ai-projector/hub
PROJECTOR_HUB_PASSWORD='<пароль браузера>' \
PROJECTOR_HUB_DEVICE_TOKEN='<токен устройств>' \
projector-hub
```

IDE работает в `prod` и не требует Vite+ на целевой машине. `projector mode dev` доступен только из checkout; переключение на `prod` в установленном пакете не запускает сборку. Checkout сохраняет прежние `vp dev`, `./bin/projector` и режимы `dev`/`prod`.

Hub по умолчанию слушает `127.0.0.1:4180`; `PROJECTOR_HUB_HOST`, `PROJECTOR_HUB_PORT` и `PROJECTOR_HUB_ORIGIN` задают адрес. Для удалённого origin нужен HTTPS от reverse proxy, который сохраняет Host и поддерживает WebSocket и SSE. Устройство подключается в **Настройки → Hub** локального Projector. Подробности — в [docs/hub.md](hub.md).

Чтобы добавить пункт меню и команду `projector` после npm-установки:

```bash
projector-install-desktop
```

Версия в имени tarball соответствует корневому `package.json`. Для установки без глобальных прав можно добавить `--prefix ~/.local` к командам npm и включить `~/.local/bin` в `PATH`.

## Локальные tarball

Если версия ещё не опубликована:

```bash
vp install
vp run build:distribution
pnpm -C packages/ide pack --pack-destination ../../artifacts
pnpm -C packages/native pack --pack-destination ../../artifacts
pnpm -C packages/hub pack --pack-destination ../../artifacts

npm install -g ./artifacts/projector-ai-ide-0.11.0.tgz
projector --browser

npm install -g ./artifacts/projector-ai-native-0.11.0.tgz
projector --native

npm install -g ./artifacts/projector-ai-hub-0.11.0.tgz
projector-hub
```

`pnpm pack` разворачивает `workspace:*` в версию релиза, а `catalog:` — в диапазоны из `pnpm-workspace.yaml`: в registry уезжает тот же манифест, что лежит в `packages/`. `vp run build:distribution` заканчивается самопроверкой (`scripts/distribution/verify.mjs`): lockstep версий с корнем, npm-метаданные, обязательные файлы сборки, shebang у `bin`, отсутствие `.ts`-импортов и битых относительных путей в собранном коде, а также сами tarball'ы — отсутствие `workspace:`/`catalog:`, версии зависимостей, исполняемые `bin`, существование целей install-скриптов и отсутствие `.ts` в поставке.

## Публикация в npm

Публикация идёт из GitHub Actions через OIDC trusted publishing. Токены npm в workflow не нужны.

### Первый выпуск

Trusted publisher настраивается только для уже существующего пакета. Поэтому первый выпуск каждого имени делается вручную с локальным `npm login` и 2FA:

```bash
vp install
vp run build:distribution
pnpm -C packages/ide publish --access public
pnpm -C packages/native publish --access public
pnpm -C packages/hub publish --access public
```

После этого на npmjs.com для каждого пакета откройте **Settings → Trusted publishing → GitHub Actions** и укажите:

- **Organization or user:** `Sdju`
- **Repository:** `projector`
- **Workflow filename:** `publish.yml`
- **Environment name:** оставить пустым
- **Allowed actions:** разрешить `npm publish` (staged publishing не используется)

То же можно сделать из CLI (npm >= 11.15 и 2FA):

```bash
npm trust github @ai-projector/ide --file publish.yml --repo Sdju/projector --allow-publish
npm trust github @ai-projector/native --file publish.yml --repo Sdju/projector --allow-publish
npm trust github @ai-projector/hub --file publish.yml --repo Sdju/projector --allow-publish
```

Конфигурация должна подтвердиться первым успешным publish в течение двух дней. После проверки OIDC можно включить **Settings → Publishing access → Require two-factor authentication and disallow tokens**.

### Автоматический выпуск

Workflow `.github/workflows/publish.yml` запускается на `release: published` и вручную через `workflow_dispatch`.

- Проверяет, что тег `vX.Y.Z` совпадает с `version` в корневом `package.json`.
- Собирает и проверяет все три пакета.
- Публикует `pnpm publish` из `packages/ide`, затем `packages/native` и `packages/hub`.
- Пропускает уже опубликованную версию, поэтому повторный запуск безопасен.
- Требует `permissions: id-token: write`; provenance создаётся автоматически.

Релиз создаётся из тега, который указывает на коммит с той же версией. Существующий тег `v0.10.0` уже занят, поэтому для первого npm-выпуска нужен новый тег после изменения `version`.

## Поведение без дополнения

Без `@ai-projector/native` обычный запуск с режимом `native` открывает браузер. Явные `--browser` и `--window` сохраняют своё поведение. Сохранённый выбор интерфейса не перезаписывается. Если дополнение установлено при работающем web-резиденте, перезапустите Projector, чтобы заменить его нативным; restart завершает терминалы и дочерние процессы.

Файлы, Git, поиск, терминалы, агенты, фоновые задания, Docker, Dev Container, LAN и PWA используют тот же сервер. Трей и глобальный хоткей работают через OS-резидент без GTK; для них нужна поддерживаемая desktop-сессия. В Linux без дополнения недоступен каталог системных приложений GIO; поиск проектов работает. Каталоги приложений Windows и macOS не требуют GTK.

GTK загружается отдельным процессом дополнения. В Linux запуск только трея не создаёт палитру и не вызывает `Gtk.init()`: окно создаётся при первом обращении. Установка одного IDE-пакета не пытается собрать `node-gtk`, в том числе через `optionalDependencies`.

Один сервер на машину, расположение данных и правила завершения терминалов при restart/quit остаются прежними. Дополнение нужно ставить рядом с IDE: установка в другой npm prefix не подключает его автоматически.

Hub не содержит локального API Projector и не требует доверия к устройству: он отдаёт общий интерфейс и передаёт запросы подключённым устройствам. Версии Hub и устройств обновляйте вместе.

## Устройство пакетов

В git у IDE остаются только манифест, README и скрипты сборки; у native и hub рядом лежит исходник. Собранное печатает `packages/<name>/scripts/build.mjs`, и эти пути перечислены в `.gitignore`. Каталог пакета совпадает с корнем установки: CLI и сервер отсчитывают его на три уровня вверх от своего модуля и читают оттуда `package.json`, `dist/`, `packages/`, `resources/` и `bin/`. Поэтому `package.json` лежит рядом с собранным деревом, а не в отдельной обёртке.

- **IDE** содержит `core`, `server` и `cli` физически, поэтому в npm уходит один пакет без внутренних зависимостей и без рассинхрона версий. TypeScript преобразуется в JavaScript: Node не снимает типы внутри `node_modules`, а собранные agent-host, раннеры и MCP-серверы запускаются из этого же дерева.
- **Native** — обычный пакет со своим `dist/`: `Palette.vue` компилируется, общие модули берутся из `@ai-projector/ide/core/*`. В `dependencies` он держит только `@ai-projector/ide` (через `workspace:*`, pnpm сам подставит версию релиза), `@zede/vio` и `node-gtk`. `@ai-projector/core` нужен лишь для исходников и объявлен в `devDependencies`, поэтому не попадает в установку потребителя. Сервер разрешает entrypoint по package exports, загрузчик GI — относительно самого дополнения.
- **Hub** собирается отдельным пакетом со своей копией `core` и общего `dist`, поэтому публичный `projector-hub` работает без установленного IDE. Остальные части `core` не загружаются: Hub импортирует только протокол туннеля. Импорты между workspace-пакетами в собранном виде заменяются на относительные пути или на публичный entrypoint IDE.

Версии внешних runtime-зависимостей заданы в манифестах протоколом `catalog:` и разворачиваются в диапазоны из `pnpm-workspace.yaml` при `pnpm publish`; `workspace:*` превращается в точную версию релиза. `node-gyp` объявлен явно: без него чистая npm-установка может выбрать старую транзитивную версию при сборке `node-pty`. Claude Agent SDK остаётся обычной зависимостью IDE; это разделение не уменьшает его размер и не поставляет собственные prebuilt-бинарники.

Версии трёх манифестов должны совпадать с корневой: это проверяет самопроверка `build:distribution`, поэтому при выпуске меняйте `version` в корне и в трёх пакетах.

В свежем checkout `vp install` собирает native сразу (`prepare`), иначе `@ai-projector/native/entry` указывает в ещё не созданный `dist/`. После правок в `packages/native` пересоберите дополнение вручную:

```bash
node packages/native/scripts/build.mjs
```

## Проверки

Проверки исходников: `vp run check` и `vp run test:gtk`. `tests/desktop-optional.test.mjs` проверяет отсутствие native/GTK при импорте, команду запуска JS-сервера и передачу команд резиденту на приватной D-Bus-шине без дисплея. Для проверки поставки устанавливайте tarball в отдельный prefix и используйте отдельные `XDG_DATA_HOME`, порт и D-Bus-сессию; пользовательский сервер перезапускать не требуется.

## Известные ограничения установки

- npm 12 по умолчанию не запускает install-скрипты. Для IDE разрешите `node-pty`, для native — ещё и `node-gtk`: `npm install -g --allow-scripts=node-pty @ai-projector/ide` и `npm install -g --allow-scripts=node-pty,node-gtk @ai-projector/native`. Hub не требует install-скриптов.
- Глобальная установка `@ai-projector/native` на npm 11/12 может упасть в install-скрипте `node-gtk` (`npx node-pre-gyp`). Если это произошло, установите native с `--ignore-scripts` и соберите `node-gtk` вручную из его каталога через `@mapbox/node-pre-gyp install --fallback-to-build`; установка native в проект вместо глобальной также обходит это ограничение.
