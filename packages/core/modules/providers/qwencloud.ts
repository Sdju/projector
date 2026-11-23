/**
 * Адреса QwenCloud. Модуль browser-safe: клиент показывает регион и предупреждает о старом
 * домене, сервер строит из того же разбора базу OpenAI-совместимого API.
 */

/** Новый домен QwenCloud: регион — первый сегмент хоста. */
export const QWENCLOUD_MAAS_SUFFIX = "maas.qwencloudapi.com";
/** Подсказка для нового провайдера; регион выбирает пользователь, а не Projector. */
export const QWENCLOUD_URL_EXAMPLE = `https://{region}.${QWENCLOUD_MAAS_SUFFIX}/compatible-mode/v1`;
/** Адрес, который Projector ставил до перехода на новый домен. */
export const QWENCLOUD_LEGACY_DEFAULT_URL =
  "https://dashscope-intl.aliyuncs.com/compatible-mode/v1";

/** Старые хосты DashScope: ключи QwenCloud и регионы с ними не совпадают. */
const LEGACY_HOSTS = ["dashscope-intl.aliyuncs.com", "dashscope.aliyuncs.com"];
const COMPATIBLE_PATH = "/compatible-mode/v1";
const DASHSCOPE_API_PATH = "/api/v1";
const ANTHROPIC_PATH = "/apps/anthropic";

export interface QwenCloudEndpoint {
  /** Схема и хост без пути. */
  origin: string;
  /** Регион из хоста `{region}.maas.qwencloudapi.com`; пусто, когда хост этого не сообщает. */
  region: string;
  /** База OpenAI-совместимого протокола, включая `/compatible-mode/v1`. */
  openAiBase: string;
  /** База DashScope HTTP, включая `/api/v1`. */
  apiBase: string;
  /** Хост принадлежит старому DashScope, а не QwenCloud. */
  legacy: boolean;
}

/** Путь без завершающих слэшей; `/compatible-mode/v1/` и `/compatible-mode/v1` равны. */
const cleanPath = (value: string): string => value.replace(/\/+$/, "");

function chatPath(path: string): string {
  if (!path) return COMPATIBLE_PATH;
  if (path.endsWith(COMPATIBLE_PATH)) return path;
  if (path.endsWith(DASHSCOPE_API_PATH))
    return `${path.slice(0, -DASHSCOPE_API_PATH.length)}${COMPATIBLE_PATH}`;
  if (path.endsWith(ANTHROPIC_PATH))
    return `${path.slice(0, -ANTHROPIC_PATH.length)}${COMPATIBLE_PATH}`;
  // Незнакомый путь может быть прокси или шлюзом клиента: не переписываем его.
  return path;
}

function mediaPath(path: string): string {
  if (!path) return DASHSCOPE_API_PATH;
  if (path.endsWith(DASHSCOPE_API_PATH)) return path;
  if (path.endsWith(COMPATIBLE_PATH))
    return `${path.slice(0, -COMPATIBLE_PATH.length)}${DASHSCOPE_API_PATH}`;
  if (path.endsWith(ANTHROPIC_PATH))
    return `${path.slice(0, -ANTHROPIC_PATH.length)}${DASHSCOPE_API_PATH}`;
  return DASHSCOPE_API_PATH;
}

/** Разбирает адрес провайдера, бросив понятную ошибку на пустом или невалидном URL. */
export function qwenCloudEndpoint(rawUrl: string): QwenCloudEndpoint {
  const value = rawUrl.trim();
  if (!value) throw new Error("Укажите адрес QwenCloud");
  let parsed: URL;
  try {
    parsed = new URL(/^https?:\/\//i.test(value) ? value : `https://${value}`);
  } catch {
    throw new Error("Некорректный адрес QwenCloud");
  }
  if (parsed.protocol !== "https:" && parsed.protocol !== "http:")
    throw new Error("Адрес QwenCloud должен быть http(s)");
  const origin = `${parsed.protocol}//${parsed.host}`;
  const host = parsed.hostname.toLowerCase();
  const path = cleanPath(parsed.pathname);
  const legacy = LEGACY_HOSTS.some((item) => host === item || host.endsWith(`.${item}`));
  const region =
    !legacy && host.endsWith(`.${QWENCLOUD_MAAS_SUFFIX}`)
      ? host.slice(0, -QWENCLOUD_MAAS_SUFFIX.length - 1)
      : "";
  return {
    origin,
    region,
    openAiBase: `${origin}${chatPath(path)}`,
    apiBase: `${origin}${mediaPath(path)}`,
    legacy,
  };
}

/** То же, но без исключения: для интерфейса, где адрес ещё вводится. */
export function qwenCloudEndpointOrNull(rawUrl: string): QwenCloudEndpoint | null {
  try {
    return qwenCloudEndpoint(rawUrl);
  } catch {
    return null;
  }
}
