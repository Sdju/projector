# Архитектура Projector

Projector использует FEOD для всех приложений и собственной библиотеки renderer. Основа — `vendor/rules-example/feod.front.spec.ru.yml` и `feod.back.spec.ru.yml` из соседнего репозитория FEOD. Для тонкого клиентского слоя `common` применяются правила `docs/structure/common.md`: только универсальные однофайловые сущности, без бизнес-зависимостей и общих `index.ts`.

| Корень | Слои и назначение |
| --- | --- |
| `src` | `app` — Vue bootstrap, router, layouts, assets; `pages` — URL; `modules` — функциональность; `common` — универсальные UI/утилиты; `globals` — ambient declarations |
| `server` | `app` — Vite plugin и композиция HTTP; `routes` — обработчики по URL; `middlewares` — ограничения локального доступа; `modules` — серверная логика |
| `native` | `app` — Node CLI; `modules/desktop` — GTK/GIO, палитра, tray/hotkey; `modules/system-bus` — D-Bus без загрузки GTK |
| `core` | Независимые именованные модули: launcher model/client, project/terminal/workspace/directory contracts, file-icon resolver, Node app-paths |
| `cli` | `app` — запуск, перезапуск, desktop installation, импорт ключа |
| `packages/vio/examples/counter` | `app` — bootstrap GTK demo; `modules/counter` — компонент примера |
| `packages/vio/src` | `app` — публичная композиция библиотеки; `modules` — renderer, GTK driver/components, SFC compiler, loader |

Слой `app` собирает приложение. Модули не импортируют `app`, страницы, маршруты или middleware. Страницы независимы друг от друга; маршруты и middleware также независимы. HTTP dispatcher находится в `server/app/api.ts` и связывает их. Имена страниц соответствуют маршрутам: `/` → `pages/index.vue`, `/projects` → `pages/projects/index.vue`, `/projects/:id` → `pages/projects/[id].vue`, `/settings` → `pages/settings.vue`.

Внешние потребители модуля импортируют только его `index.ts`. Реализация остаётся приватной. Подмодуль может использовать реализацию родителя; родитель обращается к непосредственному подмодулю через его публичный API. Вложенные подмодули недоступны соседним модулям. Циклы зависимостей запрещены, включая зависимости типов.

`core` не зависит от приложений. Клиент использует только browser-compatible модули `core`; Node app-paths недоступен браузеру. Сервер использует публичные модули `core` и только `native/modules/system-bus`; GUI запускается в отдельном процессе через `native/app/entry.ts`. Native использует `core`, не импортируя серверную бизнес-логику. `vio` не зависит от Projector; его package exports (`vio`, `vio/core`, `vio/compiler`, `vio/register`) сохранены.

Каталог проектов и агент независимы в одну сторону: агент обновляет каталог. Совместное добавление проекта располагается в `project-composer`, который использует оба модуля. Настройки интерфейса на сервере принадлежат `preferences`; управление окнами не зависит от поиска launcher. Это устраняет циклы каталог/агент и launcher/window/processes.

## Проверка границ

`architecture.config.json` задаёт корни, разрешённые зависимости между приложениями и aliases. Это конфигурация локального проверяющего инструмента, не конфигурация npm-плагина FEOD. `scripts/check-architecture.mjs` анализирует TS/JS AST, оба script-блока Vue SFC, imports/reexports, literal dynamic imports, require и типовые imports. Вычисляемые imports/require запрещены. Проверяются существование локальных импортов, слой, публичность модулей, вложенность, platform dependencies, структура и циклы.

Проверка обязательна в `vp run build`, `vp run test`, `vp run check`. Vite проверяет границы при запуске/build и каждом HMR-изменении. Отдельный запуск — `vp run architecture`; проверки самого инструмента — `vp run test:architecture`. Для полного набора проверок используйте `vp run check`.

Тесты могут обращаться к приватной реализации для проверки её поведения. В частности, HMR-тесты повторно импортируют implementation-файлы с query suffix: повторный импорт одного barrel не проверял бы перезагрузку реализации. Production-код не имеет таких исключений.
