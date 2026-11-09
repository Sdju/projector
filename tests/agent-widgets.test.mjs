import "./helpers/builtins.mjs";
import { expect, test } from "vite-plus/test";
import { splitMessage } from "../packages/client/modules/widget-runtime/split.ts";

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
    await import("../packages/client/modules/widget-runtime/compile.ts");
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
    await import("../packages/client/modules/widget-runtime/compile.ts");
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
    await import("../packages/client/modules/widget-runtime/autoclose.ts");
  const { compileTemplate, loadCompiler } =
    await import("../packages/client/modules/widget-runtime/compile.ts");
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

test("project widgets are scoped and can own the answer form", async () => {
  const { registerProjectWidgets, clearProjectWidgets, isWidgetName } =
    await import("../packages/client/modules/widget-runtime/registry.ts");
  const { answerFormSource } = await import("../packages/client/modules/widget-runtime/answer.ts");
  const definition = {
    name: "ProjectForm",
    group: "project",
    summary: "форма проекта",
    answer: true,
    template: "<div />",
    example: "<ProjectForm />",
  };
  registerProjectWidgets("p1", {
    ProjectForm: { definition, component: { render: () => null } },
  });
  expect(isWidgetName("ProjectForm", "p1")).toBe(true);
  expect(isWidgetName("ProjectForm", "p2")).toBe(false);
  expect(answerFormSource("<ProjectForm />", "p1")).toBe("<ProjectForm />");
  expect(answerFormSource("<ProjectForm />", "p2")).toBeUndefined();
  clearProjectWidgets("p1");
  expect(isWidgetName("ProjectForm", "p1")).toBe(false);
});

test("a project form compiles its own template for the composer", async () => {
  const { registerProjectWidgets, clearProjectWidgets } =
    await import("../packages/client/modules/widget-runtime/registry.ts");
  const { formProblem } = await import("../packages/client/modules/widget-runtime/repair.ts");
  const definition = {
    name: "ProjectForm",
    group: "project",
    summary: "форма проекта",
    answer: true,
    template: '<IntelligentForm><Input name="note" label="Заметка" /></IntelligentForm>',
    example: "<ProjectForm />",
  };
  registerProjectWidgets("p1", {
    ProjectForm: { definition, component: { render: () => null } },
  });
  expect(await formProblem("<ProjectForm />", "p1")).toBeUndefined();
  expect(await formProblem("<ProjectForm />", "p2")).toContain("Неизвестный компонент");
  clearProjectWidgets("p1");
});

test("a form can be the next answer only as the last block of a finished message", async () => {
  const { defineWidget } = await import("../packages/core/modules/widget-catalog/index.ts");
  const { formWidget } = await import("../packages/core/modules/agent-widgets/form/index.ts");
  const { intelligentFormWidget } =
    await import("../packages/core/modules/agent-widgets/intelligent-form/index.ts");
  expect(formWidget.answer).toBe(true);
  expect(intelligentFormWidget.answer).toBe(true);
  const { registerWidget } = await import("../packages/client/modules/widget-runtime/registry.ts");
  const { answerFormSource } = await import("../packages/client/modules/widget-runtime/answer.ts");
  registerWidget({
    definition: intelligentFormWidget,
    component: { render: () => null },
  });
  registerWidget({
    definition: defineWidget({
      name: "Ask",
      group: "form",
      summary: "вопрос формой",
      answer: true,
      example: "<Ask />",
    }),
    component: { render: () => null },
  });
  registerWidget({
    definition: defineWidget({
      name: "Card",
      group: "layout",
      summary: "рамка",
      example: "<Card />",
    }),
    component: { render: () => null },
  });
  const ask = "<Ask>выбор</Ask>";
  const intelligent =
    '<IntelligentForm summary="Настройки"><Input name="name" /></IntelligentForm>';
  expect(answerFormSource(`Вот варианты:\n\n${ask}`)).toBe(ask);
  expect(answerFormSource(`Вот варианты:\n\n${intelligent}`)).toBe(intelligent);
  expect(answerFormSource(`Вот варианты:\n\n<Card>${ask}</Card>`)).toBe(`<Card>${ask}</Card>`);
  expect(answerFormSource(`Вот варианты:\n\n<Card>${intelligent}</Card>`)).toBe(
    `<Card>${intelligent}</Card>`,
  );
  expect(answerFormSource(`${ask}\n\nПосле формы`)).toBeUndefined();
  expect(answerFormSource(`${intelligent}\n\nПосле формы`)).toBeUndefined();
  expect(answerFormSource(`<Card>${ask}</Card>\n\nтекст`)).toBeUndefined();
  expect(answerFormSource("<Card>без формы</Card>")).toBeUndefined();
  expect(answerFormSource("<Ask>не закрыта")).toBeUndefined();
});

test("Form Doctor heuristics fix duplicate attributes and validate the result", async () => {
  const { registerBuiltinWidgets } = await import("../packages/client/app/widgets.ts");
  registerBuiltinWidgets();
  const { dedupeAttributes, doctorFormSource, formProblem, heuristicFormRepair } =
    await import("../packages/client/modules/widget-runtime/repair.ts");
  const broken =
    '<IntelligentForm><Checks name="next" single name="next" :options="[{value:\'release\'}]" /><Button submit>Продолжить</Button></IntelligentForm>';
  expect(await formProblem(broken)).toMatch(/Duplicate attribute/);
  const repaired = heuristicFormRepair(broken);
  expect(repaired.match(/\bname="next"/g)).toHaveLength(1);
  expect(await formProblem(repaired)).toBeUndefined();
  expect(await formProblem("<Form><Unknown /></Form>")).toContain("Неизвестный компонент");
  expect(await formProblem('<Form><Input name="a" /></Form>')).toBeUndefined();
  expect(await formProblem('<Form><Input name="a"')).toMatch(/Unexpected EOF|missing end tag/);
  expect(dedupeAttributes('<Card title="a > b" title="c" />')).toBe('<Card title="a > b" />');

  const answer = `<IntelligentForm><Input name="next" /></IntelligentForm>`;
  expect(doctorFormSource(`Вот исправление:\n\n\`\`\`vue\n${answer}\n\`\`\``)).toBe(answer);
  expect(doctorFormSource("<IntelligentForm>не закрыта")).toBeUndefined();
});

test("the reserved project-widget names match the built-in catalogue", async () => {
  const { BUILTIN_WIDGET_NAMES } = await import("../packages/core/modules/widget-catalog/index.ts");
  const { widgetCatalog } = await import("../packages/server/modules/agents/projector/index.ts");
  expect(
    widgetCatalog
      .list()
      .map((widget) => widget.name)
      .sort(),
  ).toEqual([...BUILTIN_WIDGET_NAMES].sort());
});

test("the catalog's guide is made from the definitions and covers every registered component", async () => {
  const { createWidgetCatalog, defineWidget } =
    await import("../packages/core/modules/widget-catalog/index.ts");
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

test("special widgets stay in the guide as a name and use case, with details on demand", async () => {
  const { createWidgetCatalog, defineWidget } =
    await import("../packages/core/modules/widget-catalog/index.ts");
  const catalog = createWidgetCatalog();
  catalog.register(
    defineWidget({
      name: "Trace",
      group: "data",
      summary: "редкая трассировка — используй для разбора запроса",
      props: { id: { type: "string", description: "идентификатор", required: true } },
      special: true,
      example: '<Trace id="abc" />',
    }),
  );
  catalog.register(
    defineWidget({
      name: "Stat",
      group: "data",
      summary: "показатель",
      props: { label: { type: "string", description: "подпись", required: true } },
      example: '<Stat label="A" />',
    }),
  );
  const guide = catalog.guide();
  expect(guide).toContain("Trace — редкая трассировка");
  expect(guide).toContain("describe_widget");
  expect(guide).not.toContain("<Trace");
  expect(guide).not.toContain("id: string; обязательное");
  expect(guide).toContain("Stat — показатель");
  expect(guide).toContain("<Stat");
  expect(catalog.describeSpecial("Trace")).toContain("id: string; обязательное");
  expect(catalog.describeSpecial("Trace")).toContain('<Trace id="abc" />');
  expect(() => catalog.describeSpecial("Stat")).toThrow("не специальный");
  expect(() => catalog.describeSpecial("Nope")).toThrow("Нет компонента");
});

test("the permanent guide spends its space on Field, not on old field aliases", async () => {
  const { widgetCatalog } = await import("../packages/server/modules/agents/projector/index.ts");
  const guide = widgetCatalog.guide();
  expect(guide).toContain("Field — поле формы");
  expect(guide).toContain('<Field type="select"');
  expect(guide).not.toContain("Input —");
  expect(guide).not.toContain("Checks —");
  expect(guide).not.toContain("Slider —");
  expect(guide).not.toContain("<Input ");
  expect(guide.length).toBeLessThan(9_500);
  expect(widgetCatalog.get("Input")?.hidden).toBe(true);
  expect(widgetCatalog.describe("Input")).toContain("Свойства:");
  expect(widgetCatalog.describe("Field")).toContain("type: string");
});

test("InlineIcon offers exactly the names its prompt documents", async () => {
  const { INLINE_ICON_NAMES } =
    await import("../packages/core/modules/agent-widgets/inline-icon/index.ts");
  const { icons } = await import("../packages/client/modules/agent-widgets/_/index.ts");
  expect(Object.keys(icons).sort()).toEqual([...INLINE_ICON_NAMES].sort());
});

test("the definitions, the client components and both composition lists stay one set", async () => {
  const { readdirSync, readFileSync } = await import("node:fs");
  const { widgetCatalog } = await import("../packages/server/modules/agents/projector/index.ts");
  const names = readdirSync(
    new URL("../packages/core/modules/agent-widgets", import.meta.url),
  ).sort();
  expect(names.length).toBeGreaterThan(10);
  const server = readFileSync(
    new URL("../packages/server/app/widgets.ts", import.meta.url),
    "utf8",
  );
  const client = readFileSync(
    new URL("../packages/client/app/widgets.ts", import.meta.url),
    "utf8",
  );
  // Globs, not variable imports: a widget added since the Vite cache was written still resolves.
  const clientModules = import.meta.glob("../packages/client/modules/agent-widgets/*/index.ts", {
    eager: true,
  });
  const coreModules = import.meta.glob("../packages/core/modules/agent-widgets/*/index.ts", {
    eager: true,
  });
  for (const name of names) {
    const id = name.replace(/-([a-z])/g, (_, letter) => letter.toUpperCase());
    const entry = clientModules[`../packages/client/modules/agent-widgets/${name}/index.ts`]?.[id];
    const definition =
      coreModules[`../packages/core/modules/agent-widgets/${name}/index.ts`]?.[`${id}Widget`];
    expect(entry, name).toBeDefined();
    expect(definition, name).toBeDefined();
    expect(entry.definition, name).toBe(definition);
    expect(server, name).toContain(`${id}Widget`);
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
