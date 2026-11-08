# IDE и нативная палитра

Исходники остаются в одном pnpm workspace. Для установки на другую машину собираются два публичных npm-пакета:

| Артефакт               | Содержимое                                             | Требования                                                                     |
| ---------------------- | ------------------------------------------------------ | ------------------------------------------------------------------------------ |
| `@projector-ai/ide`    | Сервер, готовый веб-интерфейс, CLI, терминалы и агенты | Node.js 24.11–24.x; Python, make и C++ compiler для сборки `node-pty` на Linux |
| `@projector-ai/native` | GTK-палитра и каталог приложений GIO                   | IDE той же версии, GTK4, GObject Introspection и зависимости сборки `node-gtk` |

Внутренние workspace-пакеты `@projector/client`, `@projector/server`, `@projector/native`, `@projector/core` и `@projector/cli` остаются `private` и в npm не попадают. Публичные имена задаёт `scripts/build-distribution.mjs`.

## Установка из npm

```bash
# Только IDE — GTK, vio и Vite не устанавливаются.
npm install -g @projector-ai/ide
projector --browser

# Необязательное дополнение — в тот же npm prefix.
npm install -g @projector-ai/native
projector --native
```

IDE работает в `prod` и не требует Vite+ на целевой машине. `projector mode dev` доступен только из checkout; переключение на `prod` в установленном пакете не запускает сборку. Checkout сохраняет прежние `vp dev`, `./bin/projector` и режимы `dev`/`prod`.

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
vp run verify:distribution
vp -C artifacts/distribution/ide pm pack --pack-destination ..
vp -C artifacts/distribution/native pm pack --pack-destination ..

npm install -g ./artifacts/distribution/projector-ai-ide-0.10.0.tgz
projector --browser

npm install -g ./artifacts/distribution/projector-ai-native-0.10.0.tgz
projector --native
```

`vp run verify:distribution` проверяет имена, версии, `publishConfig`, зависимости и отсутствие `workspace:`/`catalog:` и старого scope `@projector/` в собранных файлах.

## Публикация в npm

Публикация идёт из GitHub Actions через OIDC trusted publishing. Токены npm в workflow не нужны.

### Первый выпуск

Trusted publisher настраивается только для уже существующего пакета. Поэтому первый выпуск каждого имени делается вручную с локальным `npm login` и 2FA:

```bash
vp install
vp run build:distribution
vp run verify:distribution
npm publish ./artifacts/distribution/ide --access public
npm publish ./artifacts/distribution/native --access public
```

После этого на npmjs.com для каждого пакета откройте **Settings → Trusted publishing → GitHub Actions** и укажите:

- **Organization or user:** `Sdju`
- **Repository:** `projector`
- **Workflow filename:** `publish.yml`
- **Environment name:** оставить пустым
- **Allowed actions:** разрешить `npm publish` (staged publishing не используется)

То же можно сделать из CLI (npm >= 11.15 и 2FA):

```bash
npm trust github @projector-ai/ide --file publish.yml --repo Sdju/projector --allow-publish
npm trust github @projector-ai/native --file publish.yml --repo Sdju/projector --allow-publish
```

Конфигурация должна подтвердиться первым успешным publish в течение двух дней. После проверки OIDC можно включить **Settings → Publishing access → Require two-factor authentication and disallow tokens**.

### Автоматический выпуск

Workflow `.github/workflows/publish.yml` запускается на `release: published` и вручную через `workflow_dispatch`.

- Проверяет, что тег `vX.Y.Z` совпадает с `version` в корневом `package.json`.
- Собирает и проверяет оба пакета.
- Публикует `@projector-ai/ide`, затем `@projector-ai/native`.
- Пропускает уже опубликованную версию, поэтому повторный запуск безопасен.
- Требует `permissions: id-token: write`; provenance создаётся автоматически.

Релиз создаётся из тега, который указывает на коммит с той же версией. Существующий тег `v0.10.0` уже занят, поэтому для первого npm-выпуска нужен новый тег после изменения `version`.

## Поведение без дополнения

Без `@projector-ai/native` обычный запуск с режимом `native` открывает браузер. Явные `--browser` и `--window` сохраняют своё поведение. Сохранённый выбор интерфейса не перезаписывается. Если дополнение установлено при работающем web-резиденте, перезапустите Projector, чтобы заменить его нативным; restart завершает терминалы и дочерние процессы.

Файлы, Git, поиск, терминалы, агенты, фоновые задания, Docker, Dev Container, LAN и PWA используют тот же сервер. Трей и глобальный хоткей работают через OS-резидент без GTK; для них нужна поддерживаемая desktop-сессия. В Linux без дополнения недоступен каталог системных приложений GIO; поиск проектов работает. Каталоги приложений Windows и macOS не требуют GTK.

GTK загружается отдельным процессом дополнения. В Linux запуск только трея не создаёт палитру и не вызывает `Gtk.init()`: окно создаётся при первом обращении. Установка одного IDE-пакета не пытается собрать `node-gtk`, в том числе через `optionalDependencies`.

Один сервер на машину, расположение данных и правила завершения терминалов при restart/quit остаются прежними. Дополнение нужно ставить рядом с IDE: установка в другой npm prefix не подключает его автоматически.

## Устройство артефактов

`scripts/build-distribution.mjs` сохраняет структуру `packages/core`, `packages/server`, `packages/cli`, ресурсы и готовый `dist` внутри IDE. TypeScript преобразуется в JavaScript, импорты и пути helper-процессов переписываются для собранных файлов. Node не пытается снимать типы внутри `node_modules`; запускаются также скомпилированные agent-host, раннеры и MCP-серверы.

Native содержит скомпилированный Vue-компонент и зависит от IDE той же версии. Общие модули берёт из экспортов `@projector-ai/ide/core/*`; сервер разрешает entrypoint по package exports, а загрузчик GI — относительно самого дополнения. Корневые devDependencies checkout для этого не нужны.

Версии внешних runtime-зависимостей берутся из catalog в lockfile. `node-gyp` объявлен явно: без него чистая npm-установка может выбрать старую транзитивную версию при сборке `node-pty`. Claude Agent SDK остаётся обычной зависимостью IDE; это разделение не уменьшает его размер и не поставляет собственные prebuilt-бинарники.

## Проверки

Проверки исходников: `vp run check` и `vp run test:gtk`. `tests/desktop-optional.test.mjs` проверяет отсутствие native/GTK при импорте, команду запуска JS-сервера и передачу команд резиденту на приватной D-Bus-шине без дисплея. Для проверки поставки устанавливайте tarball в отдельный prefix и используйте отдельные `XDG_DATA_HOME`, порт и D-Bus-сессию; пользовательский сервер перезапускать не требуется.

## Известные ограничения установки

- npm 12 по умолчанию не запускает install-скрипты. Для IDE разрешите `node-pty`, для native — ещё и `node-gtk`: `npm install -g --allow-scripts=node-pty @projector-ai/ide` и `npm install -g --allow-scripts=node-pty,node-gtk @projector-ai/native`.
- Глобальная установка `@projector-ai/native` на npm 11/12 может упасть в install-скрипте `node-gtk` (`npx node-pre-gyp`). Если это произошло, установите native с `--ignore-scripts` и соберите `node-gtk` вручную из его каталога через `@mapbox/node-pre-gyp install --fallback-to-build`; установка native в проект вместо глобальной также обходит это ограничение.
