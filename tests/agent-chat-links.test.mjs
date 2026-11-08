import { expect, test } from "vite-plus/test";
import { parseChatLink } from "../packages/client/modules/agent/lib/chat-links.ts";
import { renderMarkdown } from "../packages/client/modules/agent/lib/markdown.ts";
import {
  absoluteLocalPath,
  fileUrlPath,
  isLocalPath,
} from "../packages/client/common/utilities/file-path.ts";

test("web addresses keep the browser's own action", () => {
  expect(parseChatLink("https://example.com/docs")).toMatchObject({ kind: "web" });
  expect(parseChatLink("mailto:someone@example.com")).toMatchObject({ kind: "web" });
  expect(parseChatLink("//example.com/x")).toMatchObject({ kind: "web" });
});

test("an anchor is not a file and a foreign scheme is not a link to open", () => {
  expect(parseChatLink("#section")).toMatchObject({ kind: "anchor" });
  expect(parseChatLink("javascript:alert(1)")).toMatchObject({ kind: "other" });
  expect(parseChatLink("data:text/plain,hi")).toMatchObject({ kind: "other" });
});

test("a project-relative link is a file link", () => {
  expect(parseChatLink("./docs/usage.md")).toEqual({
    href: "./docs/usage.md",
    kind: "file",
    path: "docs/usage.md",
    external: false,
  });
  expect(parseChatLink("src/app.ts#L12-L34")).toMatchObject({
    kind: "file",
    path: "src/app.ts",
    external: false,
    line: 12,
    endLine: 34,
  });
  expect(parseChatLink("src/app.ts:12:5")).toMatchObject({
    kind: "file",
    path: "src/app.ts",
    line: 12,
    column: 5,
  });
  expect(parseChatLink("docs/usage.md?plain=1#setup")).toMatchObject({
    kind: "file",
    path: "docs/usage.md",
    external: false,
  });
});

test("absolute paths and file URLs are file links outside the project", () => {
  expect(parseChatLink("/tmp/shot.png")).toMatchObject({
    kind: "file",
    path: "/tmp/shot.png",
    external: true,
  });
  expect(parseChatLink("file:///tmp/My%20file.md")).toMatchObject({
    kind: "file",
    path: "/tmp/My file.md",
    external: true,
  });
  expect(parseChatLink("C:\\work\\app.ts")).toMatchObject({
    kind: "file",
    path: "C:\\work\\app.ts",
    external: true,
  });
});

test("project paths become absolute without touching local paths", () => {
  expect(isLocalPath("/tmp/a")).toBe(true);
  expect(isLocalPath("src/a.ts")).toBe(false);
  expect(absoluteLocalPath("/home/me/project", "src/a.ts")).toBe("/home/me/project/src/a.ts");
  expect(absoluteLocalPath("/home/me/project/", "./a.ts")).toBe("/home/me/project/a.ts");
  expect(absoluteLocalPath("", "a.ts")).toBe("a.ts");
  expect(fileUrlPath("file:///tmp/a%20b.txt")).toBe("/tmp/a b.txt");
  expect(fileUrlPath("file://localhost/tmp/a.txt")).toBe("/tmp/a.txt");
});

test("a chat file link is marked for the click handler and keeps its new-tab fallback", () => {
  const html = renderMarkdown("[usage](docs/usage.md) and [site](https://example.com)");
  expect(html).toContain('data-chat-file=""');
  expect(html).toContain('title="Открыть файл в Projector"');
  expect(html).toContain('target="_blank"');
  expect(html).toContain('rel="noopener noreferrer"');
});
