import { expect, test } from "vite-plus/test";
import {
  fromProxyUrl,
  isLocalBrowserTarget,
  normalizeBrowserInput,
  parseProxyHost,
  proxyAvailableFor,
  proxySuffix,
  proxyUrl,
} from "../core/modules/browser/index.ts";
import { rewriteCss, rewriteHtml } from "../server/modules/browser/rewrite.ts";
import {
  clearCookies,
  cookieHeader,
  siteOf,
  storeCookie,
} from "../server/modules/browser/cookies.ts";
import { isInternalAddress, isInternalLiteral } from "../server/modules/browser/guard.ts";

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
  expect(html).toContain('T="https://example.com"');
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
