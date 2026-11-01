import { expect, test } from "vite-plus/test";
import { chatImageSource } from "../src/modules/chat-images/index.ts";
import { renderMarkdown } from "../src/modules/agent/lib/markdown.ts";

const project = "p";

function endpoint(source, kind) {
  const url = new URL(source, "http://projector.invalid");
  expect(url.pathname).toBe(`/api/projects/${project}/workspace/${kind}`);
  return url.searchParams.get("path");
}

test("a chat image resolves to a safe workspace endpoint", () => {
  expect(endpoint(chatImageSource("/tmp/figma-xray-overview.png", project), "external-asset")).toBe(
    "/tmp/figma-xray-overview.png",
  );
  expect(endpoint(chatImageSource("/home/user/shot.jpg", project), "external-asset")).toBe(
    "/home/user/shot.jpg",
  );
  expect(endpoint(chatImageSource("file:///tmp/a%20b.png", project), "external-asset")).toBe(
    "/tmp/a b.png",
  );
  expect(endpoint(chatImageSource("C:\\shots\\a.png", project), "external-asset")).toBe(
    "C:\\shots\\a.png",
  );
  expect(endpoint(chatImageSource("C:/shots/a.png", project), "external-asset")).toBe(
    "C:/shots/a.png",
  );
});

test("a project-relative image goes through the asset endpoint", () => {
  expect(endpoint(chatImageSource("screens/a b.png", project), "asset")).toBe("screens/a b.png");
  expect(endpoint(chatImageSource("./screens/a.png", project), "asset")).toBe("screens/a.png");
});

test("web and inline sources stay as they are", () => {
  for (const source of [
    "https://example.com/a.png",
    "http://example.com/a.png",
    "data:image/png;base64,AAAA",
    "DATA:IMAGE/GIF;base64,AAAA",
    "blob:http://localhost/abcd",
  ])
    expect(chatImageSource(source, project)).toBe(source);
  expect(chatImageSource("//cdn.example.com/a.png", project)).toBe("https://cdn.example.com/a.png");
});

test("the app's own routes are not rewritten", () => {
  for (const source of [
    "/api/projects/x/workspace/asset?path=a.png",
    "/assets/logo.png",
    "/file-icons/file.svg",
  ])
    expect(chatImageSource(source, project)).toBe(source);
});

test("unsafe or foreign sources are refused", () => {
  for (const source of [
    "../secret.png",
    "screens/../shot.png",
    "../../etc/passwd",
    "javascript:alert(1)",
    "JAVASCRIPT:alert(1)",
    "vbscript:msgbox(1)",
    "mailto:someone@example.com",
    "#anchor",
    "",
  ])
    expect(chatImageSource(source, project)).toBeUndefined();
  expect(chatImageSource(".\\secret.png", project)).toBeUndefined();
});

test("local images need a project; external ones do not", () => {
  expect(chatImageSource("/tmp/a.png", "")).toBeUndefined();
  expect(chatImageSource("screens/a.png", "")).toBeUndefined();
  expect(chatImageSource("file:///tmp/a.png", "")).toBeUndefined();
  expect(chatImageSource("https://example.com/a.png", "")).toBe("https://example.com/a.png");
  expect(chatImageSource("data:image/png;base64,AAAA", "")).toBe("data:image/png;base64,AAAA");
});

test("rendering resolves images and keeps the alt and title", () => {
  const html = renderMarkdown('![Общий вид](/tmp/figma.png "Обзор")', {
    resolveImage: (src) => chatImageSource(src, project),
  });
  expect(html).toContain('src="/api/projects/p/workspace/external-asset?path=%2Ftmp%2Ffigma.png"');
  expect(html).toContain('alt="Общий вид"');
  expect(html).toContain('title="Обзор"');
  expect(html).toContain('loading="lazy"');
  expect(html).toContain('decoding="async"');
  expect(html).toContain('referrerpolicy="no-referrer"');
  expect(html).toContain('class="md-image"');
});

test("an unresolved image renders its alt text, not a broken image", () => {
  const html = renderMarkdown("![Пиксель](/tmp/a.png)", { resolveImage: () => undefined });
  expect(html).not.toContain("<img");
  expect(html).not.toContain("</a>");
  expect(html).toContain('<span class="md-image-text">Пиксель</span>');
  const empty = renderMarkdown("![Пиксель](x.png)", { resolveImage: () => "" });
  expect(empty).not.toContain("<img");
  expect(empty).toContain("Пиксель");
});

test("without a resolver an image is ordinary markdown", () => {
  const html = renderMarkdown("![a](x.png)");
  expect(html).toContain('<img src="x.png"');
  expect(html).toContain('alt="a"');
});
