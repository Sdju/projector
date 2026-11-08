import {
  defineComponent,
  h,
  onBeforeUnmount,
  onMounted,
  reactive,
  ref,
  shallowRef,
  type Component,
  type PropType,
} from "vue";
import type { ProjectWidgetDefinition } from "@projector/core/modules/widget-catalog/index.ts";
import { compileTemplate, loadCompiler, type RenderFn } from "./compile.ts";
import { readProjectWidgetData } from "./project-api.ts";
import { registeredWidgets } from "./registry.ts";

const injected = new Set<string>();

/** A stable class for one project widget; the same name in another project gets another class. */
function scopeClass(projectId: string, name: string): string {
  let hash = 2166136261;
  for (const char of `${projectId}:${name}`) hash = Math.imul(hash ^ char.charCodeAt(0), 16777619);
  return `pw-${(hash >>> 0).toString(36)}`;
}

/** Prefix every top-level selector with the widget's wrapper; keyframes and fonts stay global. */
function scopeCss(css: string, scope: string): string {
  const source = css.replace(/\/\*[\s\S]*?\*\//g, "").trim();
  const prefix = `.${scope}`;
  let output = "";
  let at = 0;
  while (at < source.length) {
    const open = source.indexOf("{", at);
    if (open < 0) break;
    const selector = source.slice(at, open).trim();
    if (!selector) {
      at = open + 1;
      continue;
    }
    let depth = 1;
    let end = open + 1;
    while (end < source.length && depth > 0) {
      if (source[end] === "{") depth++;
      else if (source[end] === "}") depth--;
      end++;
    }
    const body = source.slice(open + 1, end - 1);
    if (/^@(media|supports|container|layer)\b/i.test(selector))
      output += `${selector}{${scopeCss(body, scope)}}`;
    else if (/^@(keyframes|-webkit-keyframes|font-face|property|counter-style)\b/i.test(selector))
      output += `${selector}{${body}}`;
    else {
      const selectors = selector
        .split(",")
        .map((item) => item.trim())
        .filter(Boolean)
        .map((item) => (item.includes("&") ? item.replaceAll("&", prefix) : `${prefix} ${item}`));
      if (selectors.length) output += `${selectors.join(",")}{${body}}`;
    }
    at = end;
  }
  return output;
}

function propShape(definition: ProjectWidgetDefinition) {
  const constructors: Record<string, unknown> = {
    string: String,
    number: Number,
    boolean: Boolean,
    array: Array,
    object: Object,
  };
  return Object.fromEntries(
    Object.entries(definition.props ?? {}).map(([name, prop]) => {
      const types = prop.type
        .split("|")
        .map((item) => constructors[item.trim()])
        .filter(Boolean);
      return [
        name,
        {
          type: (types.length === 1 ? types[0] : types) as PropType<unknown>,
          required: prop.required === true,
        },
      ];
    }),
  );
}

function injectStyles(scope: string, css: string | undefined): void {
  if (!css || injected.has(scope) || typeof document === "undefined") return;
  injected.add(scope);
  const style = document.createElement("style");
  style.dataset.projectWidget = scope;
  style.textContent = scopeCss(css, scope);
  document.head.append(style);
}

/** A project widget as a Vue component: props from the file, template compiled at runtime, data files loaded by the runtime. */
export function createProjectWidget(
  definition: ProjectWidgetDefinition,
  projectId: string,
): Component {
  const scope = scopeClass(projectId, definition.name);
  const render = shallowRef<RenderFn>();
  const failure = ref("");
  const data = reactive<Record<string, unknown>>({});
  const dataErrors = reactive<Record<string, string>>({});
  const dataLoading = ref(Boolean(definition.data));
  const dataError = ref("");
  let timer: ReturnType<typeof setInterval> | undefined;
  let disposed = false;

  async function loadData(): Promise<void> {
    if (!definition.data || disposed) return;
    if (typeof document !== "undefined" && document.visibilityState === "hidden") return;
    dataLoading.value = true;
    dataError.value = "";
    try {
      const result = await readProjectWidgetData(projectId, definition.name);
      if (disposed) return;
      Object.assign(data, result.data);
      for (const key of Object.keys(dataErrors)) delete dataErrors[key];
      Object.assign(dataErrors, result.errors);
      if (Object.keys(result.errors).length)
        dataError.value = `Не удалось прочитать: ${Object.keys(result.errors).join(", ")}`;
    } catch (error) {
      if (!disposed)
        dataError.value = error instanceof Error ? error.message : "Данные проекта недоступны";
    } finally {
      if (!disposed) dataLoading.value = false;
    }
  }

  return defineComponent({
    name: `ProjectWidget${definition.name}`,
    props: propShape(definition),
    // Resolved at render time, so a widget may compose a sibling declared later in the file.
    components: new Proxy(
      {},
      {
        get: (_target, name) => registeredWidgets(projectId)[String(name)],
        has: (_target, name) => String(name) in registeredWidgets(projectId),
      },
    ),
    setup(props, { slots }) {
      injectStyles(scope, definition.styles);
      void loadCompiler()
        .then(() => {
          if (!disposed) render.value = compileTemplate(definition.template);
        })
        .catch((error) => {
          if (!disposed) failure.value = error instanceof Error ? error.message : String(error);
        });
      onMounted(() => {
        void loadData();
        if (definition.refresh) timer = setInterval(loadData, definition.refresh * 1_000);
      });
      onBeforeUnmount(() => {
        disposed = true;
        if (timer) clearInterval(timer);
      });
      const base = {
        data,
        dataErrors,
        dataLoading,
        dataError,
        $slots: slots,
      };
      const context = new Proxy(base, {
        get(target, key) {
          if (typeof key === "string" && Object.hasOwn(props, key))
            return (props as Record<string, unknown>)[key];
          return Reflect.get(target, key);
        },
        has(target, key) {
          return (typeof key === "string" && Object.hasOwn(props, key)) || key in target;
        },
      });
      const cache: unknown[] = [];
      return () => {
        if (failure.value)
          return h("div", { class: "project-widget-failure", role: "alert" }, failure.value);
        if (dataLoading.value)
          return h("div", { class: "project-widget-loading" }, "Читаю данные…");
        try {
          return h("div", { class: `project-widget ${scope}` }, [
            render.value ? render.value(context, cache) : null,
          ]);
        } catch (error) {
          failure.value = error instanceof Error ? error.message : String(error);
          return h("div", { class: "project-widget-failure", role: "alert" }, failure.value);
        }
      };
    },
  });
}
