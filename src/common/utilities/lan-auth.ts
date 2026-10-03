const TOKEN_KEY = "projector:lan-password";

type FetchLike = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;

/**
 * Оригинальный fetch, захваченный один раз до переопределения window.fetch.
 * Глобальный символ защищает от повторной обёртки при HMR-перезагрузке модуля.
 */
const NATIVE_FETCH = Symbol.for("projector.native-fetch");
const fetchHost = globalThis as unknown as Record<symbol, unknown>;
const nativeFetch = (fetchHost[NATIVE_FETCH] as FetchLike | undefined) ??
  (fetchHost[NATIVE_FETCH] = globalThis.fetch.bind(globalThis) as FetchLike);

/** Пароль доступа по сети хранится только в sessionStorage, не на диске. */
export function lanPassword(): string | null {
  return sessionStorage.getItem(TOKEN_KEY);
}

export function setLanPassword(value: string): void {
  sessionStorage.setItem(TOKEN_KEY, value);
}

export function clearLanPassword(): void {
  sessionStorage.removeItem(TOKEN_KEY);
}

function isSameOrigin(url: string): boolean {
  if (url.startsWith("/")) return true;
  try {
    return new URL(url, window.location.origin).origin === window.location.origin;
  } catch {
    return false;
  }
}

let promptPending: Promise<string | null> | null = null;

function requestPassword(): Promise<string | null> {
  promptPending ??= new Promise<string | null>((resolve) => {
    const value = window.prompt("Projector защищён паролем. Введите пароль доступа:");
    resolve(value);
  }).finally(() => {
    promptPending = null;
  });
  return promptPending;
}

/**
 * fetch с Bearer-токеном для запросов на свой origin. При 401 запрашивает пароль
 * и повторяет запрос один раз. Внешние запросы (провайдеры и т.п.) не меняются.
 */
export async function authedFetch(
  input: RequestInfo | URL,
  init?: RequestInit,
): Promise<Response> {
  const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
  if (!isSameOrigin(url)) return nativeFetch(input, init);

  const headers = () => {
    const result = new Headers(init?.headers);
    const token = lanPassword();
    if (token) result.set("Authorization", `Bearer ${token}`);
    return result;
  };

  let response = await nativeFetch(input, { ...init, headers: headers() });
  if (response.status === 401) {
    const password = await requestPassword();
    if (password) {
      setLanPassword(password);
      const retry = new Headers(init?.headers);
      retry.set("Authorization", `Bearer ${password}`);
      response = await nativeFetch(input, { ...init, headers: retry });
    }
  }
  return response;
}
