import * as Vue from "vue";

type Compiler = typeof import("@vue/compiler-dom");

let compiler: Compiler | undefined;
let loading: Promise<Compiler> | undefined;
/** The compiler is only needed once a message carries a component, so it stays out of the main bundle. */
export function loadCompiler(): Promise<Compiler> {
  return (loading ??= import("@vue/compiler-dom").then((module) => (compiler = module)));
}

export type RenderFn = (ctx: unknown, cache: unknown[]) => Vue.VNodeChild;
const templates = new Map<string, RenderFn>();

/** Slots run later, after the host restored block tracking. Their growing trees need a full diff too. */
const templateRuntime = {
  ...Vue,
  withCtx(...args: Parameters<typeof Vue.withCtx>) {
    const [slot, ...context] = args;
    return Vue.withCtx(
      (...slotArgs: unknown[]) => {
        Vue.setBlockTracking(-1);
        try {
          return slot(...slotArgs);
        } finally {
          Vue.setBlockTracking(1);
        }
      },
      ...context,
    );
  },
};

/** A template into its render function; the same template text is compiled once. */
export function compileTemplate(template: string): RenderFn {
  const known = templates.get(template);
  if (known) return known;
  if (!compiler) throw new Error("The template compiler is not loaded yet");
  const { code } = compiler.compile(template, {
    mode: "function",
    onError(error) {
      throw error;
    },
  });
  // Compiler output is `const _Vue = Vue; …; return function render(_ctx, _cache) {…}`. It tells Vue
  // the slots are stable (`_: 1`), which is true for one template but not when a growing message
  // swaps one template for the next: Vue would skip re-rendering the slot content. Dynamic slots
  // (`_: 2`) are diffed in full.
  const render = new Function("Vue", code.replaceAll("_: 1 /* STABLE */", "_: 2 /* DYNAMIC */"))(
    templateRuntime,
  ) as RenderFn;
  if (templates.size >= 200) templates.delete(templates.keys().next().value!);
  templates.set(template, render);
  return render;
}

/**
 * What a `<script>` can use; it is the body of a function and ends in `return { … }`. Names the
 * message's other scripts returned are readable (and assignable) as plain variables.
 */
export const scriptHelpers = {
  ref: Vue.ref,
  reactive: Vue.reactive,
  computed: Vue.computed,
  watch: Vue.watch,
  // The script runs outside a component instance, so "mounted" is the next tick.
  onMounted: (hook: () => void) => void Vue.nextTick(hook),
};

export type ScriptFn = (...args: unknown[]) => Record<string, unknown> | undefined;
const scripts = new Map<string, ScriptFn>();

export function compileScript(script: string): ScriptFn {
  const known = scripts.get(script);
  if (known) return known;
  const fn = new Function(
    ...Object.keys(scriptHelpers),
    "reply",
    "scope",
    `with (scope) {\n${script}\n}`,
  ) as ScriptFn;
  if (scripts.size >= 200) scripts.delete(scripts.keys().next().value!);
  scripts.set(script, fn);
  return fn;
}
