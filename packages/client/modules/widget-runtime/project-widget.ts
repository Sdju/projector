import {
  defineComponent,
  effectScope,
  h,
  onBeforeUnmount,
  onMounted,
  reactive,
  ref,
  shallowRef,
  unref,
  type Component,
  type EffectScope,
  type PropType,
} from "vue";
import type { ProjectWidgetDefinition } from "@ai-projector/core/modules/widget-catalog/index.ts";
import { useWidgetReply } from "./bridge.ts";
import {
  compileScript,
  compileTemplate,
  loadCompiler,
  scriptHelpers,
  type RenderFn,
} from "./compile.ts";
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

/** A project widget as a Vue component: props from the file, template compiled at runtime, data and script per mounted widget. */
export function createProjectWidget(
  definition: ProjectWidgetDefinition,
  projectId: string,
): Component {
  const scope = scopeClass(projectId, definition.name);
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
      const reply = useWidgetReply();
      const render = shallowRef<RenderFn>();
      const failure = ref("");
      const data = reactive<Record<string, unknown>>({});
      const dataErrors = reactive<Record<string, string>>({});
      const dataLoading = ref(Boolean(definition.data));
      const dataError = ref("");
      const scriptState = reactive<Record<string, unknown>>({});
      const scriptReady = ref(!definition.script);
      let timer: ReturnType<typeof setInterval> | undefined;
      let disposed = false;
      let loaded = false;
      let scriptStarted = false;
      let scriptScope: EffectScope | undefined;

      function startScript(): void {
        if (scriptStarted || disposed) return;
        scriptStarted = true;
        if (!definition.script) {
          scriptReady.value = true;
          return;
        }
        const readOnly = new Set(["props", "data", "dataErrors", "dataLoading", "dataError"]);
        // The script is the body of a function: free names come through this scope, while the
        // helpers and `reply` are its parameters (compileScript). A returned object becomes the
        // template's own state.
        const scriptContext = new Proxy({} as Record<PropertyKey, unknown>, {
          has: (_, key) =>
            typeof key === "string" && (readOnly.has(key) || Object.hasOwn(scriptState, key)),
          get: (_, key) => {
            if (key === "props") return props;
            if (key === "data") return data;
            if (key === "dataErrors") return dataErrors;
            if (key === "dataLoading") return dataLoading;
            if (key === "dataError") return dataError;
            return typeof key === "string" ? scriptState[key] : undefined;
          },
          set: (_, key, value) => {
            if (typeof key !== "string" || readOnly.has(key)) return true;
            scriptState[key] = value;
            return true;
          },
        });
        try {
          scriptScope = effectScope(true);
          const returned = scriptScope.run(() =>
            compileScript(definition.script!)(
              ...Object.values(scriptHelpers),
              reply,
              scriptContext,
            ),
          );
          if (returned) Object.assign(scriptState, returned);
        } catch (error) {
          scriptScope?.stop();
          scriptScope = undefined;
          failure.value = error instanceof Error ? error.message : String(error);
        } finally {
          scriptReady.value = true;
        }
      }

      async function loadData(): Promise<void> {
        if (!definition.data || disposed) return;
        // Polling pauses in a hidden tab; the first read still happens, because the script waits for it.
        if (loaded && typeof document !== "undefined" && document.visibilityState === "hidden")
          return;
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
          if (!disposed) {
            loaded = true;
            dataLoading.value = false;
            startScript();
          }
        }
      }

      injectStyles(scope, definition.styles);
      void loadCompiler()
        .then(() => {
          if (!disposed) render.value = compileTemplate(definition.template);
        })
        .catch((error) => {
          if (!disposed) failure.value = error instanceof Error ? error.message : String(error);
        });
      onMounted(() => {
        if (definition.data) void loadData();
        else startScript();
        if (definition.refresh) timer = setInterval(loadData, definition.refresh * 1_000);
      });
      onBeforeUnmount(() => {
        disposed = true;
        scriptScope?.stop();
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
          if (typeof key === "string") {
            if (Object.hasOwn(props, key)) return (props as Record<string, unknown>)[key];
            if (Object.hasOwn(scriptState, key)) return unref(scriptState[key]);
          }
          return unref(Reflect.get(target, key));
        },
        has(target, key) {
          return (
            (typeof key === "string" &&
              (Object.hasOwn(props, key) || Object.hasOwn(scriptState, key))) ||
            key in target
          );
        },
        set(target, key, value) {
          if (typeof key === "string" && Object.hasOwn(props, key)) return true;
          if (typeof key === "string" && Object.hasOwn(scriptState, key)) {
            scriptState[key] = value;
            return true;
          }
          return Reflect.set(target, key, value);
        },
      });
      const cache: unknown[] = [];
      return () => {
        if (failure.value)
          return h("div", { class: "project-widget-failure", role: "alert" }, failure.value);
        if (dataLoading.value)
          return h("div", { class: "project-widget-loading" }, "Читаю данные…");
        if (!scriptReady.value)
          return h("div", { class: "project-widget-loading" }, "Запускаю скрипт…");
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
