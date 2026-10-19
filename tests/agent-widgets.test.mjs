import { expect, test } from "vite-plus/test";
import { splitMessage } from "../src/modules/widget-runtime/split.ts";

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

test("a template compiles once per text and its script becomes setup state", async () => {
  const { compileScript, compileTemplate, loadCompiler } =
    await import("../src/modules/widget-runtime/compile.ts");
  await loadCompiler();
  const render = compileTemplate("<Card>{{ n * 3 }}</Card>");
  expect(compileTemplate("<Card>{{ n * 3 }}</Card>")).toBe(render);
  const script = compileScript("const n = ref(2); return { n };");
  expect(compileScript("const n = ref(2); return { n };")).toBe(script);
  const { ref } = await import("vue");
  expect(script(ref, undefined, undefined, undefined, undefined, undefined, {}).n.value).toBe(2);
});

test("a broken template throws instead of rendering", async () => {
  const { compileTemplate, loadCompiler } =
    await import("../src/modules/widget-runtime/compile.ts");
  await loadCompiler();
  expect(() => compileTemplate("<Card><div></Card>")).toThrow();
});

test("a script between blocks is the message's; one inside a component is that component's", () => {
  const script = "<script>const n = ref(1); return { n };</script>";
  const inner = "<Card><script>const m = 2; return { m };</script>{{ m }}</Card>";
  for (const text of [
    `<Card>{{ n }}</Card>\n\n${script}\n\nхвост`,
    `${script}\n\n<Card>{{ n }}</Card>\n\nхвост`,
  ]) {
    const parts = split(text);
    expect(parts.map((part) => part.type).sort()).toEqual(["markdown", "script", "widget"]);
    expect(parts.find((part) => part.type === "script")).toMatchObject({
      source: "const n = ref(1); return { n };",
      complete: true,
    });
    expect(parts.find((part) => part.type === "widget").source).toBe("<Card>{{ n }}</Card>");
  }
  const parts = split(inner);
  expect(parts.map((part) => part.type)).toEqual(["widget"]);
  expect(parts[0].source).toContain("<script>");
  // Unfinished while streaming: pending, not shown as code; once over, plain markdown.
  expect(split("<Card>a</Card>\n<script>const a", true).at(-1)).toMatchObject({
    type: "script",
    complete: false,
  });
  expect(split("текст\n<script>const a").map((part) => part.type)).toEqual(["markdown"]);
});

test("autoClose turns a half-written component into one that compiles", async () => {
  const { autoClose, parseWidgetSource } =
    await import("../src/modules/widget-runtime/autoclose.ts");
  const { compileTemplate, loadCompiler } =
    await import("../src/modules/widget-runtime/compile.ts");
  await loadCompiler();
  const full = `<Card title="a > b">
  <Row><Stat label="Л" :value="n" /><Stat label="Д" value="2" /></Row>
  <Bars :items="[{label:'x',value:1}]" />
  текст {{ n }} конец
</Card>`;
  // Every prefix of the message is something the template compiler accepts.
  for (let at = 1; at <= full.length; at++) {
    const closed = autoClose(full.slice(0, at));
    expect(() => compileTemplate(closed), JSON.stringify(full.slice(0, at))).not.toThrow();
  }
  expect(autoClose('<Card><Row><Stat label="a"')).toBe("<Card><Row></Row></Card>");
  expect(autoClose("<Card>тек {{ n")).toBe("<Card>тек </Card>");
  expect(autoClose("<Card><Stat />")).toBe("<Card><Stat /></Card>");
  expect(autoClose("<Card>a <")).toBe("<Card>a </Card>");
  // A finished message is left alone.
  expect(autoClose(full)).toBe(full);
  // The script is not part of the template, and an open one is not run.
  expect(
    parseWidgetSource("<script>const a = 1; return { a };</script><Card>{{ a }}</Card>"),
  ).toEqual({
    template: "<Card>{{ a }}</Card>",
    script: "const a = 1; return { a };",
    scriptOpen: false,
  });
  expect(parseWidgetSource("<Card>x</Card><script>const a")).toMatchObject({
    template: "<Card>x</Card>",
    scriptOpen: true,
  });
});

test("the catalog's guide is made from the definitions and covers every registered component", async () => {
  const { createWidgetCatalog, defineWidget } =
    await import("../core/modules/widget-catalog/index.ts");
  const catalog = createWidgetCatalog();
  catalog.register(
    defineWidget({
      name: "Gauge",
      group: "data",
      summary: "стрелка",
      props: {
        value: { type: "number", description: "значение", required: true },
        flag: { type: "boolean", description: "флаг" },
        label: { type: "string", description: "подпись" },
      },
      example: '<Gauge :value="1" />',
    }),
  );
  expect(catalog.guide()).toContain("Gauge — стрелка");
  expect(catalog.guide()).toContain("value: number; обязательное — значение");
  expect(catalog.guide()).toContain("flag: boolean; необязательное — флаг");
  expect(catalog.guide()).toContain('```vue\n<Gauge :value="1" />\n```');
  expect(catalog.guide()).not.toContain("flag?");
  expect(catalog.describe("Gauge")).toContain("value: number; обязательное — значение");
  expect(catalog.describe("Nope")).toContain("Нет компонента");
});

test("the definitions, the client components and both composition lists stay one set", async () => {
  const { readdirSync, readFileSync } = await import("node:fs");
  const { widgetCatalog } = await import("../server/modules/agents/projector/index.ts");
  const names = readdirSync(new URL("../core/modules/agent-widgets", import.meta.url)).sort();
  expect(names.length).toBeGreaterThan(10);
  const server = readFileSync(new URL("../server/app/widgets.ts", import.meta.url), "utf8");
  const client = readFileSync(new URL("../src/app/widgets.ts", import.meta.url), "utf8");
  for (const name of names) {
    const entry = (await import(`../src/modules/agent-widgets/${name}/index.ts`))[name];
    const definition = (await import(`../core/modules/agent-widgets/${name}/index.ts`))[
      `${name}Widget`
    ];
    expect(entry.definition, name).toBe(definition);
    expect(server, name).toContain(`${name}Widget`);
    expect(client, name).toContain(`modules/agent-widgets/${name}/index.ts`);
    // What the agent is told has to be what the component accepts.
    const accepted = Object.keys(entry.component.props ?? {})
      .filter((key) => key !== "modelValue" && key !== "modelModifiers")
      .sort();
    expect(Object.keys(definition.props ?? {}).sort(), `${definition.name} props`).toEqual(
      accepted,
    );
    expect(Boolean(definition.model), `${definition.name} v-model`).toBe(
      Object.keys(entry.component.props ?? {}).includes("modelValue"),
    );
    expect(widgetCatalog.has(definition.name), definition.name).toBe(true);
  }
});
