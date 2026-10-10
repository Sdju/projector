import { proxyUrl } from "../../../core/modules/browser/index.ts";

/** Страница, ответ которой переписывается: её адрес и окончание хоста прокси. */
export interface RewriteContext {
  /** Настоящий адрес документа. */
  page: URL;
  /** `<nonce>.proxy.localhost:<порт>` */
  suffix: string;
}

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
 * Скрипт страницы: направляет в прокси абсолютные адреса из JavaScript (fetch, XHR, sendBeacon,
 * window.open) и сообщает родителю настоящий адрес и заголовок для адресной строки.
 */
export function pageShim(context: RewriteContext): string {
  const origin = JSON.stringify(context.page.origin);
  const suffix = JSON.stringify(context.suffix);
  const source = `(function(){
var T=${origin},S=${suffix},A=/^(?:https?:)?\\/\\//i;
function map(u){try{var s=typeof u==="string"?u:u instanceof URL?u.href:"";if(!A.test(s))return u;
var x=new URL(s,location.href);if(x.hostname.indexOf(":")>=0||x.host.slice(-S.length)===S)return u;
return"http://"+x.hostname+"."+(x.protocol==="https:"?"s":"h")+x.port+"."+S+x.pathname+x.search+x.hash}catch(e){return u}}
var f=window.fetch;if(f)window.fetch=function(i,n){try{if(typeof i==="string"||i instanceof URL)i=map(i);else if(i&&i.url){var m=map(i.url);if(m!==i.url)i=new Request(m,i)}}catch(e){}return f.call(this,i,n)};
var o=XMLHttpRequest.prototype.open;XMLHttpRequest.prototype.open=function(m,u){arguments[1]=map(u);return o.apply(this,arguments)};
if(navigator.sendBeacon){var b=navigator.sendBeacon;navigator.sendBeacon=function(u,d){return b.call(this,map(u),d)}}
var w=window.open;window.open=function(u){arguments[0]=map(u);return w.apply(this,arguments)};
var last="";function report(){var u=T+location.pathname+location.search+location.hash,t=document.title,k=u+"\\n"+t;
if(k===last)return;last=k;try{parent.postMessage({projectorBrowser:true,url:u,title:t},"*")}catch(e){}}
addEventListener("load",report);addEventListener("popstate",report);addEventListener("hashchange",report);setInterval(report,500);report();
})();`;
  return `<script>${source.replace(/<\/script/gi, "<\\/script")}</script>`;
}

/** Переписывает абсолютные ссылки HTML на origin прокси и добавляет скрипт страницы. */
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
