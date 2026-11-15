import vm from "node:vm";
import { expect, test } from "vite-plus/test";
import { proxySuffix } from "../../core/modules/browser/index.ts";
import { pageShim } from "../modules/browser/page-shim.ts";

const suffix = proxySuffix("0123456789abcdef", 4177);
const context = { page: new URL("https://example.com/page/index.html"), suffix };
const proxied = (host) => `http://${host}.${suffix}`;

/** Внутренний код скрипта без тега: его можно выполнить в `node:vm`. */
function scriptOf(shim) {
  expect(shim.startsWith("<script>")).toBe(true);
  expect(shim.endsWith("</script>")).toBe(true);
  const source = shim.slice("<script>".length, -"</script>".length);
  expect(source).not.toContain("__ORIGIN__");
  expect(source).not.toContain("__SUFFIX__");
  return source;
}

/** Поддельная страница: запоминает, что именно получили fetch, XHR, sendBeacon и window.open. */
function pageOf() {
  const calls = { fetch: [], xhr: [], beacon: [], open: [] };
  const notices = [];
  const events = new Set();
  const sandbox = {
    URL,
    Request,
    location: {
      href: "https://example.com/page/index.html",
      pathname: "/page/index.html",
      search: "",
      hash: "",
    },
    document: { title: "Example" },
    parent: { postMessage: (message) => notices.push(message) },
    addEventListener: (type) => events.add(type),
    setInterval: () => 0,
    XMLHttpRequest: class {
      open(method, url) {
        calls.xhr.push([method, url]);
      }
    },
    fetch: (input, init) => {
      calls.fetch.push([input, init]);
      return Promise.resolve("ok");
    },
    open: (url, target) => {
      calls.open.push([url, target]);
      return null;
    },
    navigator: {
      sendBeacon: (url, data) => {
        calls.beacon.push([url, data]);
        return true;
      },
    },
  };
  const global = vm.createContext(sandbox);
  global.window = global;
  new vm.Script(scriptOf(pageShim(context)), { filename: "page-shim.js" }).runInContext(global, {
    timeout: 1_000,
  });
  return { global, calls, notices, events };
}

test("shim source is valid JavaScript and reports the page to the parent", () => {
  const page = pageOf();
  expect([...page.events]).toEqual(["load", "popstate", "hashchange"]);
  const notice = page.notices[0];
  expect(notice.projectorBrowser).toBe(true);
  expect(notice.url).toBe("https://example.com/page/index.html");
  expect(notice.title).toBe("Example");
});

test("shim sends absolute fetch addresses to the proxy and keeps local ones", () => {
  const page = pageOf();
  page.global.fetch("https://other.org/a.png");
  expect(page.calls.fetch.at(-1)[0]).toBe(`${proxied("other.org.s")}/a.png`);

  page.global.fetch("https://api.test:8443/v1?q=1#f");
  expect(page.calls.fetch.at(-1)[0]).toBe(`http://api.test.s8443.${suffix}/v1?q=1#f`);

  // Протокол-относительный адрес тоже абсолютный: схема берётся у самой страницы.
  page.global.fetch("//cdn.test/p.js");
  expect(page.calls.fetch.at(-1)[0]).toBe(`${proxied("cdn.test.s")}/p.js`);

  // Адрес уже в прокси повторно не переписывается, как и локальный, якорный и не-HTTP.
  page.global.fetch(`${proxied("other.org.s")}/a.png`);
  expect(page.calls.fetch.at(-1)[0]).toBe(`${proxied("other.org.s")}/a.png`);
  for (const value of [
    "/api/x",
    "rel/a.png",
    "#top",
    "mailto:a@b.test",
    "data:image/png;base64,AA",
  ]) {
    page.global.fetch(value);
    expect(page.calls.fetch.at(-1)[0]).toBe(value);
  }
});

test("shim rewrites a Request, XHR, sendBeacon and window.open", () => {
  const page = pageOf();

  page.global.fetch(new Request("https://other.org/r.json"));
  const request = page.calls.fetch.at(-1)[0];
  expect(request instanceof Request).toBe(true);
  expect(request.url).toBe(`${proxied("other.org.s")}/r.json`);

  const xhr = new page.global.XMLHttpRequest();
  xhr.open("GET", "https://other.org/x");
  expect(page.calls.xhr.at(-1)).toEqual(["GET", `${proxied("other.org.s")}/x`]);
  xhr.open("GET", "/local");
  expect(page.calls.xhr.at(-1)).toEqual(["GET", "/local"]);

  page.global.navigator.sendBeacon("https://other.org/beacon", "body");
  expect(page.calls.beacon.at(-1)).toEqual([`${proxied("other.org.s")}/beacon`, "body"]);

  page.global.window.open("https://other.org/popup", "_blank");
  expect(page.calls.open.at(-1)).toEqual([`${proxied("other.org.s")}/popup`, "_blank"]);
  page.global.window.open();
  expect(page.calls.open.at(-1)[0]).toBeUndefined();
});

test("shim escapes </script> so the page cannot close its own element", () => {
  // Origin настоящего сайта такого не содержит, но подстановка обязана экранировать и это.
  const hostile = { page: { origin: "https://example.com</script><script>alert(1)" }, suffix };
  const shim = pageShim(hostile);
  expect(shim).toContain("<\\/script");
  expect(scriptOf(shim)).not.toMatch(/<\/script/i);
  // В обычном скрипте единственный закрывающий тег — последний.
  expect(pageShim(context).match(/<\/script/gi)).toHaveLength(1);
});
