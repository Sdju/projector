/**
 * Скрипт страницы прокси. Отдельный исходник, а не строка внутри `rewrite.ts`: код исполняется в
 * браузере, поэтому его читают и правят как обычный JavaScript.
 */

/** Страница, ответ которой переписывается: её настоящий адрес и окончание хоста прокси. */
export interface PageContext {
  /** Настоящий адрес документа. */
  page: URL;
  /** `<nonce>.proxy.localhost:<порт>` */
  suffix: string;
}

/**
 * Плейсхолдеры `__ORIGIN__` и `__SUFFIX__` заменяются JSON-строками, поэтому origin и суффикс
 * попадают в код экранированными, а шаблон остаётся читаемым текстом.
 */
const PLACEHOLDER = /__([A-Z]+)__/g;

function fill(template: string, values: Record<string, string>): string {
  return template.replace(PLACEHOLDER, (whole: string, name: string) => {
    const value = values[name];
    if (value === undefined) throw new Error(`Неизвестный плейсхолдер скрипта страницы: ${whole}`);
    return value;
  });
}

/**
 * Тело скрипта. Абсолютные адреса из JavaScript (fetch, XHR, sendBeacon, window.open) получают
 * origin прокси, а родителю уходит настоящий адрес и заголовок для адресной строки.
 *
 * Ограничение: адрес собирается из частей (`url.origin + "/api"`) уже после подмены, поэтому
 * такой запрос прокси не увидит. Заменяются только значения, переданные целиком.
 */
const PAGE_SHIM = `
(function () {
  var pageOrigin = __ORIGIN__;
  var proxySuffix = __SUFFIX__;
  // Переписываются только абсолютные (https://…) и протокол-относительные (//…) адреса.
  var absolute = /^(?:https?:)?\\/\\//i;

  /**
   * Адрес на origin прокси. Исходное значение остаётся, если адрес локальный или относительный,
   * уже ведёт в прокси, передан не строкой или это IPv6-хост (у него нет поддомена).
   */
  function mapUrl(value) {
    try {
      var text = typeof value === "string" ? value : value instanceof URL ? value.href : "";
      if (!absolute.test(text)) return value;
      var url = new URL(text, location.href);
      if (url.hostname.indexOf(":") >= 0 || url.host.slice(-proxySuffix.length) === proxySuffix)
        return value;
      var scheme = url.protocol === "https:" ? "s" : "h";
      return (
        "http://" +
        url.hostname +
        "." +
        scheme +
        url.port +
        "." +
        proxySuffix +
        url.pathname +
        url.search +
        url.hash
      );
    } catch (error) {
      return value;
    }
  }

  // fetch: строка и URL заменяются, у Request меняется адрес, остальные варианты идут как есть.
  var nativeFetch = window.fetch;
  if (nativeFetch)
    window.fetch = function (input, init) {
      try {
        if (typeof input === "string" || input instanceof URL) input = mapUrl(input);
        else if (input && input.url) {
          var mapped = mapUrl(input.url);
          if (mapped !== input.url) input = new Request(mapped, input);
        }
      } catch (error) {}
      return nativeFetch.call(this, input, init);
    };

  // XMLHttpRequest: адрес — второй аргумент open().
  var nativeXhrOpen = XMLHttpRequest.prototype.open;
  XMLHttpRequest.prototype.open = function (method, url) {
    arguments[1] = mapUrl(url);
    return nativeXhrOpen.apply(this, arguments);
  };

  // navigator.sendBeacon: адрес — первый аргумент.
  if (navigator.sendBeacon) {
    var nativeBeacon = navigator.sendBeacon;
    navigator.sendBeacon = function (url, data) {
      return nativeBeacon.call(this, mapUrl(url), data);
    };
  }

  // window.open: адрес тоже первый аргумент; вызов без адреса не меняется.
  var nativeWindowOpen = window.open;
  window.open = function (url) {
    arguments[0] = mapUrl(url);
    return nativeWindowOpen.apply(this, arguments);
  };

  // Родителю нужен настоящий адрес страницы и заголовок: их показывает адресная строка Projector.
  var reported = "";
  function report() {
    var url = pageOrigin + location.pathname + location.search + location.hash;
    var title = document.title;
    var current = url + "\\n" + title;
    if (current === reported) return;
    reported = current;
    try {
      parent.postMessage({ projectorBrowser: true, url: url, title: title }, "*");
    } catch (error) {}
  }
  addEventListener("load", report);
  addEventListener("popstate", report);
  addEventListener("hashchange", report);
  setInterval(report, 500);
  report();
})();
`;

/** Готовый к вставке `<script>`: `</script>` внутри кода не должен закрыть элемент раньше времени. */
export function pageShim(context: PageContext): string {
  const source = fill(PAGE_SHIM, {
    ORIGIN: JSON.stringify(context.page.origin),
    SUFFIX: JSON.stringify(context.suffix),
  });
  return `<script>${source.replace(/<\/script/gi, "<\\/script")}</script>`;
}
