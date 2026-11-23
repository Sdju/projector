# QwenCloud: баланс и универсальный медиа-API

Рабочий документ: что проверено у QwenCloud, какие решения открыты и как встроить генерацию изображений, TTS, ASR и видео в Projector без привязки к одному провайдеру.

## Что проверено

QwenCloud — облако Alibaba Cloud с моделями Qwen, Wan, CosyVoice и др. Ключи и эндпоинты региональные, текст ходит по OpenAI-совместимому протоколу, а медиа — по DashScope HTTP.

- Регионы и Base URL: `https://docs.qwencloud.com/developer-guides/getting-started/regions`
- Ключи: `sk-ws-…` — pay-as-you-go, `sk-sp-…` — Token Plan. Ключ работает только с эндпоинтом своего региона; домен `{region}.maas.qwencloudapi.com`, без региона — Singapore.
- OpenAI-совместимый текст: `https://{region}.maas.qwencloudapi.com/compatible-mode/v1`.
- DashScope HTTP: `https://{region}.maas.qwencloudapi.com/api/v1`.
- Регион и адрес (закрыто): seed и пресет не выбирают регион за пользователя — адрес `https://{region}.maas.qwencloudapi.com/compatible-mode/v1` показывается подсказкой, регион хранится в самом URL. Общий разбор `packages/core/modules/providers/qwencloud.ts` принимает оба домена, origin, `/api/v1`, `/compatible-mode/v1` и `/apps/anthropic`, сохраняя незнакомый путь прокси. Чат и список моделей идут в `/compatible-mode/v1`, медиа — в `/api/v1`. Подробности вида живут в `packages/client/modules/provider-qwencloud`, общая карточка только рендерит зарегистрированную часть. Карточка показывает регион и предупреждает о старом DashScope, а `401`/`403` получают подсказку о регионе ключа.

### Медиа-эндпоинты

| Возможность                    | Запрос                                                                                      | Модели (проверенные)                                                                                   | Ответ                                                                                |
| ------------------------------ | ------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------ |
| Изображение, синхронно         | `POST /api/v1/services/aigc/multimodal-generation/generation`                               | `qwen-image-3.0-pro`, `qwen-image-3.0`, `qwen-image-2.1-pro`, `qwen-image-2.1-turbo`, `qwen-image-2.0` | `output.choices[].message.content[].image` — URL на 24 ч                             |
| Изображение, OpenAI-совместимо | `POST /compatible-mode/v1/images/generations`                                               | те же                                                                                                  | OpenAI-формат `data[].url`                                                           |
| Изображение, асинхронно        | `POST /api/v1/services/aigc/image-generation/generation` + `X-DashScope-Async: enable`      | `qwen-image-3.0*`, `qwen-image-2.1*`                                                                   | `output.task_id` → `GET /api/v1/tasks/{id}`, опрос ~10 с                             |
| TTS, не-стриминг               | `POST /api/v1/services/aigc/multimodal-generation/generation`                               | `qwen3-tts-flash`, Qwen-Audio-TTS, CosyVoice                                                           | `audio_url`, `audio_id`, `expires_at`                                                |
| TTS, стриминг                  | тот же запрос + `X-DashScope-SSE: enable`                                                   | `qwen3-tts-flash`                                                                                      | SSE-чанки, последний несёт полный URL                                                |
| ASR, короткое аудио            | `POST /api/v1/services/aigc/multimodal-generation/generation`                               | `qwen-audio-3.1-asr-flash`                                                                             | текст в `output.choices[].message.content`                                           |
| ASR, файл                      | `POST /api/v1/services/audio/asr/transcription`                                             | Fun-ASR, Paraformer                                                                                    | `task_id` → `GET /api/v1/tasks/{id}`                                                 |
| Видео                          | `POST /api/v1/services/aigc/video-generation/video-synthesis` + `X-DashScope-Async: enable` | `wan3.0-video`, `wan2.6-t2v`, `wan2.6-i2v`, HappyHorse, Vidu                                           | `output.task_id` → `GET /api/v1/tasks/{id}`, опрос ~15 с, `output.video_url` на 24 ч |

Важные ограничения из документации:

- URL результата живёт 24 часа; для истории Projector должен скачивать артефакт сразу.
- `size` у изображений задаётся как `2048*2048`; у видео — `resolution` (`720P`) и `ratio` (`16:9`), у старых Wan — `size` (`1280*720`).
- TTS принимает `input.text`, `input.voice`, `input.language_type`; голоса и языки у моделей различаются.
- ASR принимает публичный URL или data URI (`data:audio/wav;base64,…`); для локального файла нужен временный upload.
- Локальная загрузка файла: `GET /api/v1/uploads?action=…` даёт OSS policy, затем multipart на `upload_host`. Token Plan-ключи (`sk-sp-`) локальные файлы не принимают — только публичный URL или `oss://`.
- Долгие задачи: `PENDING → RUNNING → SUCCEEDED|FAILED`; отмена — `POST /api/v1/tasks/{id}/cancel` (проверить на конкретной модели).

### Временный ключ

`POST /api/v1/tokens?expire_in_seconds=N` с обычным ключом возвращает `{ token: "st-…", expires_at }`. По умолчанию 60 секунд, максимум 1800. Временный ключ наследует права и ограничения исходного, вручную удалить его нельзя. Это единственный программный способ «запросить сервисный ключ»; создать постоянный `sk-ws-` через API нельзя — только в консоли `home.qwencloud.com/api-keys`.

### Баланс

Публичного API баланса по ключу нет: `GET <origin>/user/balance`, как у DeepSeek, у QwenCloud отсутствует. Консоль показывает available balance и recent spend, но это account-level страницы.

CLI `qwencloud` (`@qwencloud/qwencloud-cli`) авторизуется через OAuth Device Flow (`t.qwencloud.com`) и хранит access token в keychain (`service=qwencloud-cli`, `account=cli_credentials`) или в зашифрованном `~/.qwencloud/credentials`. Команды `usage summary/breakdown/free-tier/payg` и `billing summary/breakdown/limit` отдают расход и квоты в `--format json`, но не кошелёк. Внутри CLI ходит в `https://cli.qwencloud.com/data/v2/api.json` с `{ product: "BssOpenAPI-V3", action, region, params }`; это внутренний API без публичного контракта.

Вывод: «сервисный ключ для баланса» в буквальном виде не существует. Есть три практичных варианта:

| Вариант                              | Что даёт                                                                                                | Цена                                                                                                                      |
| ------------------------------------ | ------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------- |
| A. CLI JSON                          | `usage`/`billing` без расхода и без доступа к секретам; Projector запускает `qwencloud … --format json` | Нужен установленный CLI; нет available balance; формат может меняться                                                     |
| B. OAuth-сессия CLI + внутренний API | account info, расход, возможно баланс через BSS                                                         | Читать/расшифровывать credentials или переиспользовать токен; нестабильный внутренний API; только с согласия пользователя |
| C. Ключ API                          | модельные вызовы и временные токены                                                                     | Баланс недоступен                                                                                                         |

Рекомендация: A для вкладки «Расход/квоты» и честный `unsupported` для кошелька; B — отдельным явным включателем «доверять сессии QwenCloud CLI», если пользователь согласен на внутренний API. Временный ключ (`/api/v1/tokens`) реализовать отдельно как короткоживущий токен для браузера/виджетов, не называя его балансовым.

## Универсальный медиа-API

Цель: одна модель данных и один набор маршрутов для изображений, TTS, ASR и видео; провайдер подключается адаптером, как балансы и агенты.

### Контракты

`packages/core/modules/media` (browser-safe, без Node):

```ts
type MediaCapability =
  | "image.generate"
  | "speech.synthesize"
  | "speech.transcribe"
  | "video.generate";

interface MediaModel {
  id: string; // id у провайдера
  alias: string; // имя в Projector
  capability: MediaCapability;
  providerId: string;
  adapter: string; // qwencloud | openai | …
  options?: MediaModelOptions; // voice, size, durations, limits
}

interface MediaArtifact {
  kind: "image" | "audio" | "video" | "text";
  mime: string;
  url?: string; // исходный URL провайдера
  fileId?: string; // скачанный артефакт Projector
  text?: string; // ASR
  expiresAt?: number;
}

interface MediaJob {
  id: string;
  status: "queued" | "running" | "succeeded" | "failed" | "cancelled";
  progress?: number;
  artifacts: MediaArtifact[];
  error?: string;
}
```

`packages/server/modules/media` — реестр и сервис, провайдеры — отдельные модули `media-qwencloud` и `media-openai`:

```ts
interface MediaAdapter {
  kind: string;
  capabilities: ReadonlySet<MediaCapability>;
  listModels(context: MediaProviderContext): Promise<MediaModel[]>;
  submit(context: MediaProviderContext, request: MediaRequest): Promise<MediaJob | MediaArtifact[]>;
  poll?(context: MediaProviderContext, job: MediaJob): Promise<MediaJob>;
  cancel?(context: MediaProviderContext, job: MediaJob): Promise<MediaJob>;
  /** Необязательно: временный ключ, upload, проверка ключа. */
  auxiliary?: { temporaryKey?: boolean; upload?: boolean };
}
```

`MediaProviderContext` повторяет `ProviderBalanceContext`: `id`, `kind`, `url`, `apiKey`, `signal`. Провайдер берётся из существующего `providers.json`; отдельного хранилища ключей не нужно. Адаптер выбирается по `kind`, а не по URL. Это даёт другим провайдерам тот же контракт: `openai` для OpenAI-совместимых изображений/аудио, `qwencloud` для DashScope, дальше — `google`, `fal`, `replicate` или плагин.

### Маршруты

```
GET  /api/media/models?capability=image.generate
POST /api/media/generate          // единый запрос: capability + providerId + model + input/options
GET  /api/media/jobs/:id
POST /api/media/jobs/:id/cancel
POST /api/media/keys/temporary    // QwenCloud: st-…, ≤1800 с
POST /api/media/uploads           // локальный файл для ASR/видео, лимит и MIME
GET  /api/media/files/:id         // скачанный артефакт с Content-Type и no-store
```

`POST /api/media/generate` возвращает `200` с готовыми артефактами (синхронные изображения, короткий ASR, TTS) или `202` с `jobId` (видео, async image, длинный ASR). Клиент и агент не знают, каким провайдером это сделано.

Опционально второй слой — OpenAI-совместимые маршруты под уже существующим шлюзом `/api/openai/v1`: `images/generations`, `audio/speech`, `audio/transcriptions`. Они не обязательны для внутреннего API, но позволяют другим приложениям на машине пользоваться теми же моделями. Видео у OpenAI и провайдеров отличается, поэтому его лучше оставить только во внутреннем API.

### Артефакты

- Скачивать URL результата сразу: 24 часа — не гарантия, а дедлайн.
- Каталог `$XDG_DATA_HOME/projector/media/<provider>/<yyyy-mm>/<sha256>.<ext>`, метаданные в `media/index.json` (атомарная запись, как у остальных store).
- Лимиты: изображение 32 МиБ, аудио 64 МиБ, видео 512 МиБ. Скачивание с таймаутом, без redirect, только публичный `https`, allowlist хостов провайдера и безопасные MIME-типы.
- Хранить 30 дней по умолчанию, чистить при старте и по кнопке; «сохранить в проект» копирует файл в выбранную папку.
- Никогда не отдавать upstream URL как постоянную ссылку в UI и не логировать ключ.

### QwenCloud-адаптер

- Нормализация базы: принимает `…maas.qwencloudapi.com`, `…/api/v1`, `…/compatible-mode/v1`, а также старый `dashscope-intl.aliyuncs.com`; из неё выводит `apiBase` и `openAiBase`, сохраняя регион.
- Синхронные возможности: image, TTS, ASR — один POST, парсинг разных полей.
- Асинхронные: image-3.0/2.1, ASR-файл, видео — `submit` + `poll` с интервалом из ответа модели/CFG (10–15 с), `X-DashScope-Async: enable`.
- Загрузка: `GET /api/v1/uploads?action=…` → OSS multipart; Token Plan (`sk-sp-`) — сразу ошибка с подсказкой про публичный URL.
- Каталог моделей — статический seed в адаптере (проверенные id и лимиты), плюс необязательное обновление из консоли/CLI. Провайдерский `GET /models` медиа-модели обычно не перечисляет.
- Временный ключ — `POST /api/v1/tokens`; кешировать до `expires_at - 60 с`, не отдавать в логи, не путать с балансом.
- Ошибки: `401` — «ключ и регион не совпадают»; `InvalidApiKey`; `DataInspectionFailed`; `Throttling` — с исходным `request_id`.

### Баланс QwenCloud в Projector

- `packages/server/modules/providers/balance.ts` сейчас отдаёт `unsupported` для `qwencloud`. Это остаётся верным для кошелька.
- Вариант A (сделан): читатель расхода в модуле `provider-qwencloud`, который запускает CLI через `packages/core/modules/os` (`qwencloud usage summary --format json`, `qwencloud billing summary --format json`), нормализует в `ProviderUsage` с валютой из ответа; это расход и квоты, а не баланс. Ошибки CLI — `unavailable` с безопасным текстом.
- Вариант B: отдельный явный переключатель в настройках провайдера «читать сессию QwenCloud CLI»; сервер читает keychain/`~/.qwencloud/credentials` и вызывает `cli.qwencloud.com`. Не реализован: нужен только после подтверждения, что внутренний API стабилен, и с явным согласием пользователя.
- Серверная выдача временного ключа сделана (`POST /api/media/keys/temporary` → `/api/v1/tokens`). Кнопки в настройках пока нет: результат нужно показывать через `SafeSecretShow`, с TTL и назначением рядом.

### План

| Этап | Объём                                                                                                              | Состояние                                                                      |
| ---- | ------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------ |
| M0   | Контракты `core/media`, реестр, QwenCloud-адаптер (image + TTS + короткий ASR), маршрут `generate`, тесты парсеров | Сделано                                                                        |
| M1   | Async jobs (image/video), `poll/cancel`, скачивание артефактов и лимиты, `GET /api/media/files`                    | Сделано; задачи живут в памяти                                                 |
| M2   | Временный ключ, upload локального файла, баланс/usage через CLI, настройки и статус                                | Временный ключ (API) и расход через CLI сделаны; upload и кнопка ключа открыты |
| M3   | Клиент: вкладка workspace «Медиа», команды `ide.media.*`, сохранение в проект                                      | Вкладка и команды сделаны; сохранение в проект открыто                         |
| M4   | OpenAI-совместимые медиа-маршруты и `api.media.registerAdapter` для доверенных плагинов                            | Открыто                                                                        |

Порядок M0→M1 даёт рабочий backend, которым можно пользоваться из агента и curl, не дожидаясь UI. Текущее поведение API, модели и ограничения описаны в [медиа-моделях](../media.md).

## Итог: что осталось

Регион, разбор адреса, медиа-база и подсказки карточки закрыты. Из плана остаются:

1. **Локальная загрузка файлов** для ASR и видео: сейчас только публичный URL или base64 (M2).
2. **Сохранение результата в проект**: вкладка «Медиа» и команды готовы, экспорта в папку проекта нет (M3).
3. **OpenAI-совместимый медиа-шлюз** под `/api/openai/v1` и `api.media.registerAdapter` для доверенных плагинов (M4).
4. **Артефакты**: очистка по возрасту, сохранение задач между рестартами и удаление файлов из UI.
5. **TTS streaming и фоновое распознавание** длинных файлов (Fun-ASR/Paraformer).
6. **Реальный аккаунт**: проверить `usage summary`/`billing summary`, временный ключ и кнопку выдачи ключа в настройках.

### Риски

- Внутренний API CLI и состав полей `billing` могут измениться без предупреждения; не строить на нём критичный индикатор.
- Каталог моделей и лимиты QwenCloud меняются; seed должен быть явным и легко правиться.
- 24-часовые URL и большие видео: обязательное локальное скачивание и очистка.
- Token Plan не принимает локальные файлы; это ограничение ключа, а не адаптера.
- Медиа-файлы могут быть большими: нельзя буферизовать видео в память, только поток в файл.
- Нельзя смешивать `qwencloud` и старый DashScope: ключи региональные, 401 выглядит как «неверный ключ».
