import { proxyUrl } from "@ai-projector/core/modules/browser/index.ts";
import { pageShim, type PageContext } from "./page-shim.ts";

/** Страница, ответ которой переписывается: её адрес и окончание хоста прокси. */
export type RewriteContext = PageContext;
export { pageShim };

const ABSOLUTE = /^(?:https?:)?\/\//i;

/**
 * Относительные ссылки (`/a.png`, `b.css`) работают сами: документ и так на origin сайта.
 * Переписываются только абсолютные ссылки на другие хосты.
 */
function remap(value: string, context: RewriteContext): string | undefined {
  const text = value.trim();
  if (!ABSOLUTE.test(text)) return;
  try {
    return proxyUrl(new URL(text, context.page), context.suffix);
  } catch {
    return;
  }
}

/** Переписывает абсолютные `url()` и `@import`; экранирование и скобки внутри `url()` не разбираются. */
export function rewriteCss(css: string, context: RewriteContext): string {
  return css
    .replace(/url\(\s*(["']?)([^"')]*?)\1\s*\)/gi, (whole, quote: string, value: string) => {
      const target = remap(value, context);
      return target ? `url(${quote}${target}${quote})` : whole;
    })
    .replace(/@import\s+(["'])([^"']+)\1/gi, (whole, quote: string, value: string) => {
      const target = remap(value, context);
      return target ? `@import ${quote}${target}${quote}` : whole;
    });
}

const URL_ATTRIBUTES =
  /(\s(?:src|href|action|formaction|poster|data|background)\s*=\s*)(?:"([^"]*)"|'([^']*)')/gi;
const SRCSET = /(\ssrcset\s*=\s*)(?:"([^"]*)"|'([^']*)')/gi;
const STYLE_ATTRIBUTE = /(\sstyle\s*=\s*)(?:"([^"]*)"|'([^']*)')/gi;
const STYLE_BLOCK = /(<style\b[^>]*>)([\s\S]*?)(<\/style>)/gi;
const INTEGRITY = /\sintegrity(?:\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+))?(?=[\s>/])/gi;
const META_BLOCKED =
  /<meta\b[^>]*http-equiv\s*=\s*["']?(?:content-security-policy|set-cookie)[^>]*>/gi;

function quoted(
  prefix: string,
  double: string | undefined,
  single: string | undefined,
  map: (value: string) => string,
) {
  const quote = double !== undefined ? '"' : "'";
  return `${prefix}${quote}${map(double ?? single ?? "")}${quote}`;
}

/**
 * Переписывает абсолютные ссылки HTML на origin прокси и добавляет скрипт страницы.
 *
 * Разметка разбирается регулярными выражениями, а не парсером, поэтому есть осознанные
 * ограничения. Переписываются только значения в кавычках (двойных или одинарных): атрибуты без
 * кавычек (`src=https://…`) остаются как есть. Нестандартная разметка — тот же предел: ссылка,
 * собранная в `<script>` или в JSON-LD, не видна, а `srcset` делится по запятым, поэтому `data:`
 * с запятой внутри разбивается на части. В CSS не разбираются экранирование и скобки внутри
 * `url()`: `url("a(1).png")` не распознаётся. Адрес, собранный в JavaScript по частям
 * (`origin + "/api"`), тоже не переписывается — прокси видит только готовое значение. Тег,
 * попавший в комментарий или строку скрипта, будет переписан как разметка.
 */
export function rewriteHtml(html: string, context: RewriteContext): string {
  const rewritten = html
    .replace(META_BLOCKED, "")
    .replace(INTEGRITY, "")
    .replace(
      STYLE_BLOCK,
      (_, open: string, css: string, close: string) => open + rewriteCss(css, context) + close,
    )
    .replace(STYLE_ATTRIBUTE, (_whole, prefix, d, s) =>
      quoted(prefix, d, s, (value) => rewriteCss(value, context)),
    )
    .replace(SRCSET, (_whole, prefix, d, s) =>
      quoted(prefix, d, s, (value) =>
        value
          .split(",")
          .map((part) => {
            const [link, ...rest] = part.trim().split(/\s+/);
            return [(link && remap(link, context)) || link, ...rest].join(" ");
          })
          .join(", "),
      ),
    )
    .replace(URL_ATTRIBUTES, (_whole, prefix, d, s) =>
      quoted(prefix, d, s, (value) => remap(value, context) ?? value),
    );
  const shim = pageShim(context);
  const head = rewritten.match(/<head\b[^>]*>/i);
  if (head) return rewritten.replace(head[0], () => head[0] + shim);
  const root = rewritten.match(/<html\b[^>]*>/i);
  return root ? rewritten.replace(root[0], () => root[0] + shim) : shim + rewritten;
}
