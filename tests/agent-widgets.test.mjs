import { expect, test } from "vite-plus/test";
import { splitMessage } from "../src/modules/agent/lib/widget-split.ts";

const known = (name) => ["Card", "Bars"].includes(name);
const split = (text, streaming = false) => splitMessage(text, { known, streaming });

test("a finished component sits between markdown parts", () => {
  const parts = split("Вот:\n\n<Bars :items=\"[{label:'a',value:1}]\" />\n\nИтог.");
  expect(parts.map((part) => part.type)).toEqual(["markdown", "widget", "markdown"]);
  expect(parts[1]).toMatchObject({ name: "Bars", complete: true });
});

test("nested same-name tags and quoted > are balanced", () => {
  const source = '<Card><Card :x="a > b">in</Card></Card>';
  expect(split(`${source}\nпосле`)[0]).toMatchObject({ source, complete: true });
});

test("streaming: an unfinished component is the last part and keeps finished sources stable", () => {
  const head = "<Card>one</Card>\n\n";
  const first = split(`${head}<Card><Bars`, true);
  const second = split(`${head}<Card><Bars :items="[]"/>\n</Card>`, true);
  expect(first.at(-1)).toMatchObject({ type: "widget", complete: false });
  expect(first[0]).toEqual(second[0]);
  expect(second.at(-1)).toMatchObject({ complete: true });
});

test("when streaming ends an unfinished component is plain markdown", () => {
  expect(split("<Card>без конца").map((part) => part.type)).toEqual(["markdown"]);
});

test("code fences and unknown names are not components", () => {
  expect(split("```\n<Card>x</Card>\n```").map((part) => part.type)).toEqual(["markdown"]);
  expect(split("<Unknown>x</Unknown>").map((part) => part.type)).toEqual(["markdown"]);
});

test("a component compiles once per source and its script becomes setup state", async () => {
  const { compileWidget } = await import("../src/modules/agent/lib/widget-compile.ts");
  const { createSSRApp, h } = await import("vue");
  const source = "<Card><script>const n = ref(2); return { n };</script>{{ n * 3 }}</Card>";
  const Card = {
    render() {
      return h("section", this.$slots.default?.());
    },
  };
  const first = await compileWidget(source, { Card });
  expect(await compileWidget(source, { Card })).toBe(first);
  const app = createSSRApp(first);
  const el = { children: [] };
  expect(first.setup()).toHaveProperty("n");
  void app;
  void el;
});

test("a broken template rejects instead of rendering", async () => {
  const { compileWidget } = await import("../src/modules/agent/lib/widget-compile.ts");
  await expect(compileWidget("<Card><div></Card>", {})).rejects.toThrow();
});

test("a script before or after a component belongs to it", () => {
  const body = "<Card>{{ n }}</Card>";
  const script = "<script>const n = ref(1); return { n };</script>";
  for (const text of [`${body}\n\n${script}\n\nхвост`, `${script}\n\n${body}\n\nхвост`]) {
    const parts = split(text);
    expect(parts.map((part) => part.type)).toEqual(["widget", "markdown"]);
    expect(parts[0].source).toContain("<script>");
    expect(parts[0].source).toContain("<Card>");
  }
  expect(split(`${body}\n${script.slice(0, 20)}`, true).at(-1)).toMatchObject({ complete: false });
  expect(split(`${script}\n\nпросто текст`).map((part) => part.type)).toEqual(["markdown"]);
});

test("a reply is a short line plus the data as JSON", async () => {
  const { formatWidgetReply } = await import("../src/modules/agent/lib/widget-bridge.ts");
  expect(formatWidgetReply({ a: 1 }, "Итог")).toBe('Итог\n\n```json\n{\n  "a": 1\n}\n```');
  expect(formatWidgetReply("да")).toBe("да");
});
