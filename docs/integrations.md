# Интеграции

Настройки и секреты — `packages/server/modules/integration-store`, GitHub — `packages/server/modules/github`, GitLab — `packages/server/modules/gitlab`, общее клонирование — `packages/server/modules/git-import`, статусы — `/api/integrations`.

## Хранение и доступ

- Настройки — `$XDG_DATA_HOME/projector/integrations.json`, `0600`, атомарная замена. Токены — в системном хранилище секретов (Secret Service, Credential Manager, Keychain), в файле остаётся `"vault": "keyring"`. Без хранилища они лежат в файле; `PROJECTOR_SECRET_STORE=file` отключает хранилище.
- Если запись в хранилище есть, но не открывается, изменения интеграции отклоняются, сохранённый секрет не затирается. Миграция старых открытых токенов проверяет чтение обратно.
- «Глазок» токена работает только с локальной машины, не по LAN, не для токенов из файла и намеренно не зарегистрирован IDE-командой. Токен не возвращается в браузер; `localStorage` не используется.

## GitHub

- Авторизация: Device Flow (OAuth App с **Enable Device Flow**, Client ID в настройках, scope `repo`) или PAT (fine-grained с **Contents: read**, classic — `repo`). Токен проверяется через `/user` перед сохранением. Организации могут требовать SSO.
- Импорт требует `git`: HTTPS-клон в `<папка импорта>/<repository>`, регистрация в `projects.json`. Для JS читаются `package.json` и команды, иначе — безопасная `git status`. Зависимости не ставятся, код не запускается, существующие папки не перезаписываются.
- «Выйти» удаляет токен Projector; отзыв доступа — на стороне GitHub. Выключение интеграции запрещает новые клонирования, сохраняя параметры и локальные проекты.

### Просмотр без клонирования

- `/gh/projects/owner/repository` (в строке пути `gh:/owner/repository`) — readonly-проект. Публичные репозитории доступны без входа, приватные — по токену с Contents: read.
- `?ref=branch-or-tag` выбирает ref (имена с `/` через URL encoding), `&path=src/main.ts` открывает файл; без `path` показывается README, по умолчанию — основная ветка.
- Ветка фиксируется на коммите до обновления: дерево, файлы и относительные картинки Markdown — один снимок.
- Нет записи файлов, Git-мутаций, поиска по файлам, терминалов, Docker, чата и настроек локального проекта. Файлы больше 5 MiB не открываются, подмодули недоступны, симлинки показывают свой текст.
- Вкладка «О репозитории» (`ide.github.repository.info`) — метаданные из того же запроса. Issues: страницы по 30, комментарии по 100 до 500. Pull requests: обсуждение до 500, файлы до 300, inline-комментарии к коду не показываются. Discussions: только GraphQL и токен, комментарии до 250, ответы до 50, страницы по курсору.
- Реакции — только чтение; шорткоды `:name:` заменяются эмодзи через `GET /api/integrations/github/emojis` (прокси к `/emojis`, кеш сутки).
- История — Commits API: поиск до 500 коммитов за запрос, бинарные файлы не сравниваются, для коммитов с 3000+ файлов обзор сообщает об ограничении. Режима «все ветки» нет.
- Pipelines — Actions workflow runs: фильтр статуса → `in_progress`/`failure`/`success`/`cancelled`, страницы по 30, лог до 2 MiB по подписанной ссылке (токен не передаётся хранилищу).
- Releases — GitHub Releases API: страницы по 30, `latest`, тело Markdown, вложенные ассеты и source archives (`zip`, `tar.gz`). Ассеты и исходники скачиваются через Projector потоком; токен остаётся на `api.github.com` и не уходит на подписанный URL. Черновики и приватные ассеты требуют токен с доступом к репозиторию.
- Список репозиториев владельца ограничен 1000. Команды: `ide.github.repository.open|refresh|info|clone*`, файлы и раскладка — общие `ide.fileTree.*`, `ide.editor.*`, `ide.workbench.*`.
- Клонирование — фоновая задача (`POST/GET/DELETE /api/integrations/github/clone-jobs`, отмена `ide.github.repository.clone.abort`), по умолчанию в Docker (см. [docker](docker.md)).

### GitHub в локальном проекте

Если `origin` указывает на GitHub (HTTPS, `git@github.com:…`, `ssh://…`), в обычный workspace добавляются Issues, Pull requests, Discussions, Pipelines, Releases и «О репозитории»; файлы, Git, поиск и терминалы остаются локальными. `upstream` и другие remote игнорируются. Проекты в Docker и Dev Container панели не получают.

## GitLab

- Адрес по умолчанию `https://gitlab.com`, self-hosted поддерживается. Смена адреса сбрасывает токен: он принадлежит одному серверу.
- Авторизация: Device Flow (GitLab 17.1+, OAuth Application с `read_api`, `read_repository`, `read_user`, Client ID, без secret и callback; учитываются `authorization_pending`, `slow_down`, `expired_token`, `access_denied`) или PAT со scope `read_api` и `read_repository` (проверка через `/api/v4/user`).
- OAuth access token обновляется по refresh за 60 секунд до истечения; параллельные вкладки делят один refresh, после `401` — один повтор. Неудачный refresh просит войти снова, сетевая ошибка учётные данные не стирает. Для PAT обновления нет.
- Токен уходит только на настроенный адрес: при self-hosted `gitlab.com` читается анонимно, перенаправления запрещены, браузеру токен не возвращается.
- Клонирование — HTTPS в `<папка импорта>/<группа>/<подгруппа>/<проект>`, `git` с `core.hooksPath=/dev/null`, токен через временный `GIT_ASKPASS`. Зависимости не ставятся, существующие папки не перезаписываются. Docker-клон общий с GitHub.
- `/gl/projects/<instance>/<group>/<project>` (`gl:/…`) — readonly-workspace: дерево, файлы, Markdown и изображения, карточка проекта, Issues, Merge requests, Pipelines с джобами и логами, история, коммиты и diff. Снимок фиксируется на коммите; `?ref=` и `?path=` как у GitHub.
- Pipelines: фильтр по статусу, джобы по стадиям, активный запуск обновляется каждые 10 секунд, лог до 2 MiB без ANSI и служебных префиксов GitLab. Провайдер общий с GitHub: `pipelines`, `pipeline`, `job`.
- Releases: страницы по 30, `upcoming_release`, ссылки `assets.links` и source archives (`zip`, `tar.gz`, `tar`, `tar.bz2`). Ссылки открываются на GitLab, исходники скачиваются через Projector; токен не уходит на подписанный URL. Для приватного проекта нужны `read_api` и `read_repository`.
- Merge requests: состояние, последний pipeline, `detailed_merge_status`, одобрения и ревьюеры, обсуждение (до 500 комментариев), изменённые файлы с inline-diff из `diff_refs`. Для fork head читается из `source_project_id`; `changes_count: "1000+"` не выдаётся за точное число; список ограничен 300 файлами, diff — 5 MiB на сторону. Approvals в списке не запрашиваются (N+1).
- Реакции на комментариях не загружаются: award emoji требуют запроса на заметку (N+1). Приватный проект без токена отвечает `404`, поэтому вкладка подключения открывается только на `401/403`.
- Команды: `ide.gitlab.repository.open|refresh|info|clone*|import`, `ide.gitlab.integration.*`; Issues — общие `ide.issues.*`, MR — `ide.mergeRequests.*`, история — `ide.git.*`.
- В локальном проекте с GitLab в `origin` добавляются Issues, Merge requests, Pipelines, Releases и «О проекте»; файлы, Git и терминалы локальные. Проекты в Docker панели не получают.

## Лимиты агентов в статусной строке

Код: встроенные адаптеры `packages/server/modules/agents-integration/{codex,claude,opencode,kimi}` и их клиентские индикаторы; Cursor отдаёт лимиты из плагина `plugins/cursor` через общий маршрут плагинного агента; общее ядро — `_` в обоих корнях. Projector не хранит секреты: используется авторизация CLI. Запросы всех окон объединяются, кеш переживает HMR, опрос — раз в минуту только в видимой вкладке, перенаправления запрещены, таймаут 10 с. `GET /api/{codex,claude,opencode,kimi}/usage` и `GET /api/agent/usage/<id>` отдают только нормализованные окна, время и безопасную ошибку. Встроенные адаптеры читают файлы авторизации через `packages/core/modules/os`; плагин Cursor делает это сам.

| Сервис   | Источник                                                                                                             | Авторизация                                                                                                                 | Особенности                                                                                                                                                            |
| -------- | -------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Codex    | `codex app-server --stdio`, JSON-RPC `account/rateLimits/read`                                                       | `codex login`                                                                                                               | Недельное окно по длительности 10080 минут; кеш 1 мин                                                                                                                  |
| Claude   | Agent SDK `usage_…` у запроса `claude` (метод нестабильный)                                                          | Вход Claude Code; Projector токен не читает                                                                                 | Окна 5ч и неделя; кеш 5 мин; без подписки или ключа — «недоступно»                                                                                                     |
| OpenCode | `GET https://opencode.ai/zen/go/v1/usage`                                                                            | `opencode-go.key` из `$XDG_DATA_HOME/opencode/auth.json` (`OPENCODE_AUTH_CONTENT`)                                          | Окна 5 часов, неделя, месяц; кеш 1 мин, ошибки тоже кешируются                                                                                                         |
| Cursor   | Плагин `plugins/cursor`: ConnectRPC `POST https://api2.cursor.sh/aiserver.v1.DashboardService/GetCurrentPeriodUsage` | `$XDG_CONFIG_HOME/cursor/auth.json` (`CURSOR_AUTH_CONTENT`), `agent login`                                                  | Окна: всего, авто-модели, API-модели; кеш 1 мин; `/api/agent/usage/cursor`                                                                                             |
| Kimi     | `GET https://api.kimi.com/coding/v1/usages`                                                                          | OAuth-токен из `~/.kimi-code/credentials/*.json` с учётом `expires_at`; обновление по `refresh_token` (`KIMI_AUTH_CONTENT`) | Окна 5 часов, неделя (на части тарифов) и месяц (`usages.limit_5h`/`limit_7d`, `limit_month_total`/`limit_month_code`, `totalQuota`); неизвестная форма — «недоступно» |

Codex и Cursor перед запросом выполняют probe `GET https://ipwho.is/`: Codex — через `packages/server/modules/network/eu-context.ts`, Cursor — внутри `plugins/cursor/src/usage.ts`. Лимиты запрашиваются только при `success: true` и `is_eu: true`.

Kimi Code выдаёт access token на 15 минут. Projector читает текущий слот из `config.toml` (`[providers."managed:kimi-code".oauth]`) и обновляет пару по `refresh_token` за `max(300 s, expires_in / 2)` до истечения, под тем же локом CLI `~/.kimi-code/oauth/<slot>.lock`, с атомарной записью и проверкой ротации: если CLI успел обновить токен, используется его пара. `KIMI_CODE_HOME`, `KIMI_OAUTH_HOST` и `KIMI_CODE_OAUTH_HOST` учитываются. Новые тарифы Kimi не имеют недельного окна, поэтому индикатор показывает первое доступное окно, а клик пропускает отсутствующие.

Индикатор показывает **оставшийся** процент окна; клик переключает окно без запросов (`ide.<агент>.usage.window.cycle`, у плагинов — `ide.plugin.<id>.usage.window.cycle`), выбор не сохраняется. Ошибка — «—», а не исчерпание квоты. На мобильном те же значения показывает меню «Новая сессия», опрос идёт только пока меню открыто.

Каждый ответ `/api/{codex,claude,opencode,kimi}/usage` и `/api/agent/usage/<id>` записывается в `agent/analytics.sqlite`, поэтому вкладка «Аналитика расхода» строит историю заполнения окон без отдельных опросов: точки появляются, пока индикаторы в статусной строке опрашивают сервисы, или после кнопки «Обновить» в самой аналитике. Отключённые агенты не опрашиваются. Расчёт темпа, хранение и API описаны в [аналитике](analytics.md).

### Баланс провайдера

Пятый индикатор показывает баланс **активного** провайдера (`packages/server/modules/providers/balance.ts`, `GET /api/providers/balance?id=…`). Тип (`kind`) — `deepseek`, `qwencloud`, `local` или `custom`; у старых провайдеров определяется по адресу.

| Тип               | Баланс                                                                                                                                                      |
| ----------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `deepseek`        | `GET <origin>/user/balance` с ключом: сумма, пополненное и подарочные по валютам, `is_available`; кеш 1 мин, ошибки 15 с, без перенаправлений, таймаут 10 с |
| `qwencloud`       | Нет: только CLI `qwencloud-usage` с отдельным входом; по ключу API недоступен                                                                               |
| `local`, `custom` | Нет; индикатор скрыт                                                                                                                                        |

Суммы остаются десятичными строками, как их вернул провайдер. Расход за период DeepSeek по API не отдаёт, поэтому Projector записывает каждый успешный ответ `/api/providers/balance` в `agent/analytics.sqlite` (`provider_samples`) с id и именем провайдера: падения баланса считаются расходом, пополнения — отдельно. История начинается с первой проверки и видна во вкладке «Аналитика расхода» ([подробно](analytics.md)).

## Провайдеры и модели

- Провайдер хранит `models: [{ id, alias }]`: `id` уходит провайдеру, `alias` — имя для агента и шлюза (по умолчанию `id`, уникально в пределах провайдера). Старое поле `model` при чтении превращается в одну модель.
- Список моделей загружается через `POST /api/providers/models` (`GET <url>/models` по схеме OpenAI; черновик может передать свой `url` и ключ, сохранённый ключ подставляется только известному провайдеру).
- `enabled` включает провайдера; модели всех включённых выбираются в чате (`провайдер:имя`) и перечислены в `/api/openai/v1/models`. `activeProviderId` задаёт баланс и провайдера по умолчанию.
- Команды: `ide.providers.models.refresh|register`, `ide.providers.enabled.set`, `ide.providers.add`, `ide.providers.balance.show|refresh`.
