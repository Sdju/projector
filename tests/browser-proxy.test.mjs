import { expect, test } from "vite-plus/test";
import {
  browserFrameSrc,
  fromProxyPath,
  isLocalBrowserTarget,
  normalizeBrowserInput,
  toProxyPath,
} from "../core/modules/browser/index.ts";
import { rewriteCss, rewriteHtml } from "../server/modules/browser/proxy.ts";

test("address bar input becomes a URL, a dev server or a search", () => {
  expect(normalizeBrowserInput("localhost:3000/app")).toBe("http://localhost:3000/app");
  expect(normalizeBrowserInput(":5173")).toBe("http://localhost:5173/");
  expect(normalizeBrowserInput("example.com/a?b=1")).toBe("https://example.com/a?b=1");
  expect(normalizeBrowserInput("как это работает")).toContain("duckduckgo.com/?q=");
  expect(normalizeBrowserInput("  ")).toBe("");
});

test("proxy paths round-trip and local targets stay direct", () => {
  const url = "https://example.com:8443/a/b?x=1";
  expect(fromProxyPath(toProxyPath(url))).toBe(url);
  expect(fromProxyPath("/api/other/https/x/")).toBeUndefined();
  expect(isLocalBrowserTarget("http://localhost:5173/")).toBe(true);
  expect(isLocalBrowserTarget("http://192.168.0.5:3000/")).toBe(true);
  expect(isLocalBrowserTarget("https://example.com/")).toBe(false);
  expect(browserFrameSrc("http://localhost:5173/")).toBe("http://localhost:5173/");
  expect(browserFrameSrc("https://example.com/")).toBe("/api/browser/https/example.com/");
  expect(browserFrameSrc("http://localhost:5173/", true)).toBe("/api/browser/http/localhost:5173/");
});

test("HTML and CSS links are routed through the proxy", () => {
  const html = rewriteHtml(
    `<html><head><base href="/docs/"><meta http-equiv="Content-Security-Policy" content="x"></head><body>
      <a href="/root">a</a><a href="rel.html">b</a><a href="https://other.org/x">c</a><a href="#top">d</a>
      <img src="//cdn.test/i.png" srcset="a.png 1x, /b.png 2x"><script src="/s.js" integrity="sha" crossorigin></script>
      <div style="background:url('/bg.png')"></div></body></html>`,
    "https://example.com/page/index.html",
  );
  expect(html).toContain('href="/api/browser/https/example.com/root"');
  expect(html).toContain('href="/api/browser/https/example.com/docs/rel.html"');
  expect(html).toContain('href="/api/browser/https/other.org/x"');
  expect(html).toContain('href="#top"');
  expect(html).toContain('src="/api/browser/https/cdn.test/i.png"');
  expect(html).toContain("/api/browser/https/example.com/docs/a.png 1x");
  expect(html).toContain('src="/api/browser/https/example.com/s.js"');
  expect(html).not.toMatch(/integrity|crossorigin|Content-Security-Policy|<base/i);
  expect(html).toContain("url('/api/browser/https/example.com/bg.png')");
  expect(html).toContain("projectorBrowser");
});

test("CSS url() and @import are rewritten against the stylesheet", () => {
  const css = rewriteCss(
    '@import "x.css"; a{background:url(../i.png)} b{background:url(data:image/png;base64,AA)}',
    "https://example.com/css/site.css",
  );
  expect(css).toContain('@import "/api/browser/https/example.com/css/x.css"');
  expect(css).toContain("url(/api/browser/https/example.com/i.png)");
  expect(css).toContain("url(data:image/png;base64,AA)");
});
