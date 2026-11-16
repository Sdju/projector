import { expect, test } from "vite-plus/test";
import {
  fromProxyUrl,
  isLocalBrowserTarget,
  normalizeBrowserInput,
  parseProxyHost,
  proxyAvailableFor,
  proxySuffix,
  proxyUrl,
} from "../../core/modules/browser/index.ts";
import { rewriteCss, rewriteHtml } from "../modules/browser/rewrite.ts";
import { clearCookies, cookieHeader, siteOf, storeCookie } from "../modules/browser/cookies.ts";
import { isInternalAddress, isInternalLiteral } from "../modules/browser/guard.ts";

const suffix = proxySuffix("0123456789abcdef", 4177);
const origin = (host) => `http://${host}.0123456789abcdef.proxy.localhost:4177`;

test("address bar input becomes a URL, a dev server or a search", () => {
  expect(normalizeBrowserInput("localhost:3000/app")).toBe("http://localhost:3000/app");
  expect(normalizeBrowserInput(":5173")).toBe("http://localhost:5173/");
  expect(normalizeBrowserInput("example.com/a?b=1")).toBe("https://example.com/a?b=1");
  expect(normalizeBrowserInput("как это работает")).toContain("duckduckgo.com/?q=");
  expect(normalizeBrowserInput("  ")).toBe("");
});

test("every site gets its own proxy origin and maps back", () => {
  const url = "https://example.com:8443/a/b?x=1#h";
  const mapped = proxyUrl(url, suffix);
  expect(mapped).toBe(`${origin("example.com.s8443")}/a/b?x=1#h`);
  expect(fromProxyUrl(mapped)).toBe(url);
  expect(parseProxyHost("Example.COM.h.0123456789abcdef.proxy.localhost:4177")).toEqual({
    origin: "http://example.com",
    nonce: "0123456789abcdef",
    suffix,
  });
  expect(parseProxyHost("localhost:4177")).toBeUndefined();
  expect(parseProxyHost("a.s.zz.proxy.localhost")).toBeUndefined();
  expect(proxyUrl("ftp://example.com/", suffix)).toBeUndefined();
  expect(proxyUrl("http://[2001:db8::1]/", suffix)).toBeUndefined();
});

test("local targets stay direct; the proxy needs Projector on this machine", () => {
  expect(isLocalBrowserTarget("http://localhost:5173/")).toBe(true);
  expect(isLocalBrowserTarget("http://192.168.0.5:3000/")).toBe(true);
  expect(isLocalBrowserTarget("https://example.com/")).toBe(false);
  expect(proxyAvailableFor("localhost")).toBe(true);
  expect(proxyAvailableFor("192.168.0.174")).toBe(false);
});

test("only absolute links are routed through the proxy", () => {
  const context = { page: new URL("https://example.com/page/index.html"), suffix };
  const html = rewriteHtml(
    `<html><head><meta http-equiv="Content-Security-Policy" content="x"></head><body>
      <a href="/root">a</a><a href="rel.html">b</a><a href="https://other.org/x">c</a><a href="#top">d</a>
      <img src="//cdn.test/i.png" srcset="a.png 1x, https://cdn.test/b.png 2x">
      <script src="https://cdn.test/s.js" integrity="sha" crossorigin></script>
      <div style="background:url('https://cdn.test/bg.png')"></div></body></html>`,
    context,
  );
  expect(html).toContain('href="/root"');
  expect(html).toContain('href="rel.html"');
  expect(html).toContain(`href="${origin("other.org.s")}/x"`);
  expect(html).toContain(`src="${origin("cdn.test.s")}/i.png"`);
  expect(html).toContain(`${origin("cdn.test.s")}/b.png 2x`);
  expect(html).toContain(`${origin("cdn.test.s")}/s.js`);
  expect(html).not.toMatch(/integrity=|Content-Security-Policy/i);
  expect(html).toContain(`url('${origin("cdn.test.s")}/bg.png')`);
  expect(html).toContain("projectorBrowser");
  expect(html).toContain('var pageOrigin = "https://example.com"');
});

test("single quotes, uppercase markup and spaced meta CSP are handled", () => {
  const context = { page: new URL("https://example.com/page/index.html"), suffix };
  const html = rewriteHtml(
    `<HTML><HEAD><META HTTP-EQUIV = "Content-Security-Policy" content="default-src 'none'">
      <meta  http-equiv=set-cookie  content="sid=1"><meta name="description" content="x"></HEAD>
      <BODY><IMG SRC='https://cdn.test/a.png'>
      <A HREF = '//other.org/x'>x</A><FORM ACTION='https://forms.test/send'></FORM></BODY></HTML>`,
    context,
  );
  expect(html).toContain(`SRC='${origin("cdn.test.s")}/a.png'`);
  expect(html).toContain(`HREF = '${origin("other.org.s")}/x'`);
  expect(html).toContain(`ACTION='${origin("forms.test.s")}/send'`);
  expect(html).not.toMatch(/content-security-policy|set-cookie/i);
  expect(html).toContain('<meta name="description" content="x">');
  // Скрипт страницы вставляется в <HEAD>, написанный в верхнем регистре.
  expect(html).toMatch(/<HEAD><script>/i);
});

test("srcset is split by commas, so data: URIs inside it are documented breakage", () => {
  const context = { page: new URL("https://example.com/page/index.html"), suffix };
  const html = rewriteHtml(
    `<img srcset="data:image/png;base64,AAAA 1x, https://cdn.test/b.png 2x" src="data:image/gif;base64,R0lGOD">`,
    context,
  );
  // Атрибут src с data: остаётся как есть; srcset разбит по запятым — это ограничение regex-подхода.
  expect(html).toContain('src="data:image/gif;base64,R0lGOD"');
  expect(html).toContain(
    `srcset="data:image/png;base64, AAAA 1x, ${origin("cdn.test.s")}/b.png 2x"`,
  );
});

test("<style> blocks, style attributes and quoted CSS url() are rewritten", () => {
  const context = { page: new URL("https://example.com/page/index.html"), suffix };
  const html = rewriteHtml(
    `<style>@import 'https://x.test/a.css'; b{background:url( "https://y.test/i.png" )}
      c{background:url('https://z.test/i(1).png')}</style>
      <div style='background-image:url("https://cdn.test/bg.png")'></div>`,
    context,
  );
  expect(html).toContain(`@import '${origin("x.test.s")}/a.css'`);
  expect(html).toContain(`url("${origin("y.test.s")}/i.png")`);
  // Скобки внутри url() и экранирование в CSS regex не разбирает — адрес остаётся настоящим.
  expect(html).toContain("url('https://z.test/i(1).png')");
  expect(html).toContain(`style='background-image:url("${origin("cdn.test.s")}/bg.png")'`);
});

test("JSON-LD and inline scripts are left alone", () => {
  const context = { page: new URL("https://example.com/page/index.html"), suffix };
  const html = rewriteHtml(
    `<head><script type="application/ld+json">{"image":"https://cdn.test/i.png","note":"<\\/script>"}</script>
      <script>var api = "https://api.test/x";</script></head>`,
    context,
  );
  expect(html).toContain('"image":"https://cdn.test/i.png"');
  expect(html).toContain("<\\/script>");
  expect(html).toContain('var api = "https://api.test/x"');
});

test("relative, anchor and non-http addresses are not rewritten", () => {
  const context = { page: new URL("https://example.com/page/index.html"), suffix };
  const html = rewriteHtml(
    `<a href="/root">a</a><a href="rel.html">b</a><a href="#top">c</a><a href="?q=1">d</a>
      <a href="mailto:a@b.test">e</a><a href="tel:+100">f</a><a href="javascript:void 0">g</a>
      <form action="ftp://files.test/up"></form><img src="data:image/png;base64,AA">`,
    context,
  );
  for (const value of [
    'href="/root"',
    'href="rel.html"',
    'href="#top"',
    'href="?q=1"',
    'href="mailto:a@b.test"',
    'href="tel:+100"',
    'href="javascript:void 0"',
    'action="ftp://files.test/up"',
    'src="data:image/png;base64,AA"',
  ])
    expect(html).toContain(value);
});

test("attributes without quotes are documented as not rewritten", () => {
  const context = { page: new URL("https://example.com/page/index.html"), suffix };
  const html = rewriteHtml(
    `<img src=https://cdn.test/u.png><a href=https://other.org/x>x</a><source srcset=https://cdn.test/s.png>`,
    context,
  );
  expect(html).toContain("src=https://cdn.test/u.png");
  expect(html).toContain("href=https://other.org/x");
  expect(html).toContain("srcset=https://cdn.test/s.png");
});

test("CSS url() and @import are rewritten, relative ones are kept", () => {
  const css = rewriteCss(
    '@import "https://x.test/x.css"; a{background:url(../i.png)} b{background:url(https://y.test/i.png)}',
    { page: new URL("https://example.com/css/site.css"), suffix },
  );
  expect(css).toContain(`@import "${origin("x.test.s")}/x.css"`);
  expect(css).toContain("url(../i.png)");
  expect(css).toContain(`url(${origin("y.test.s")}/i.png)`);
});

test("cookie jar scopes cookies by host, path, secure and SameSite", () => {
  clearCookies();
  const page = new URL("https://shop.example.com/a/b");
  storeCookie("sid=1; Path=/; HttpOnly", page);
  storeCookie("shared=2; Domain=example.com; Path=/", page);
  storeCookie("lax=3; SameSite=Lax", page);
  storeCookie("strict=4; SameSite=Strict; Path=/", page);
  storeCookie("none=5; SameSite=None; Secure; Path=/", page);
  storeCookie("foreign=6; Domain=other.org", page);
  storeCookie("gone=7; Max-Age=0", page);
  const same = { navigation: false, sameSite: true };
  expect(cookieHeader(page, same).split("; ").sort()).toEqual(
    ["lax=3", "none=5", "shared=2", "sid=1", "strict=4"].sort(),
  );
  expect(cookieHeader(new URL("https://www.example.com/"), same)).toBe("shared=2");
  expect(cookieHeader(page, { navigation: false, sameSite: false })).toBe("none=5");
  const navigation = cookieHeader(page, { navigation: true, sameSite: false });
  expect(navigation).toContain("lax=3");
  expect(navigation).not.toContain("strict=4");
  expect(cookieHeader(new URL("http://shop.example.com/a/b"), same)).not.toContain("none=5");
  expect(siteOf("a.b.example.com")).toBe("example.com");
  expect(siteOf("shop.example.co.uk")).toBe("example.co.uk");
});

test("the proxy refuses loopback and LAN addresses", () => {
  for (const address of [
    "127.0.0.1",
    "10.1.2.3",
    "192.168.0.1",
    "172.20.0.1",
    "::1",
    "fe80::1",
    "::ffff:127.0.0.1",
  ])
    expect(isInternalAddress(address)).toBe(true);
  expect(isInternalAddress("93.184.216.34")).toBe(false);
  expect(isInternalLiteral("[::1]")).toBe(true);
  expect(isInternalLiteral("example.com")).toBe(false);
});

test("cookie jar refuses Domain set to a public suffix", () => {
  clearCookies();
  storeCookie("sid=attacker; Domain=github.io; Path=/", new URL("https://attacker.github.io"));
  storeCookie("co=1; Domain=co.uk; Path=/", new URL("https://shop.example.co.uk"));
  storeCookie("ok=2; Domain=example.co.uk; Path=/", new URL("https://shop.example.co.uk"));
  const same = { navigation: false, sameSite: true };
  expect(cookieHeader(new URL("https://victim.github.io/"), same)).toBe("");
  expect(cookieHeader(new URL("https://attacker.github.io/"), same)).toBe("");
  expect(cookieHeader(new URL("https://www.example.co.uk/"), same)).toBe("ok=2");
});
