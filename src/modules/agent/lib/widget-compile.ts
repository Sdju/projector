import * as Vue from "vue";
import type { Component } from "vue";
import { useWidgetReply } from "./widget-bridge.ts";

type Compiler = typeof import("@vue/compiler-dom");

let compiler: Promise<Compiler> | undefined;
/** The compiler is only needed once a message carries a component, so it stays out of the main bundle. */
export function loadCompiler(): Promise<Compiler> {
  return (compiler ??= import("@vue/compiler-dom"));
}

const SCRIPT = /<script>([\s\S]*?)<\/script>/;
const helpers = {
  ref: Vue.ref,
  reactive: Vue.reactive,
  computed: Vue.computed,
  watch: Vue.watch,
  onMounted: Vue.onMounted,
};

/**
 * Turns a finished component source into a Vue component. A `<script>` child is the setup body:
 * it receives `ref`, `reactive`, `computed`, `watch`, `onMounted`, `reply` and returns the template scope.
 * `reply(data, summary)` sends the user's choice back to the agent as a chat message.
 * The result is cached by source, so a component is compiled once however often the message re-renders.
 */
const cache = new Map<string, Promise<Component>>();
export function compileWidget(
  source: string,
  components: Record<string, Component>,
): Promise<Component> {
  let compiled = cache.get(source);
  if (!compiled) {
    compiled = build(source, components);
    cache.set(source, compiled);
    if (cache.size > 200) cache.delete(cache.keys().next().value!);
  }
  return compiled;
}

async function build(source: string, components: Record<string, Component>): Promise<Component> {
  const { compile } = await loadCompiler();
  const script = SCRIPT.exec(source)?.[1];
  const template = source.replace(SCRIPT, "");
  const { code } = compile(template, {
    mode: "function",
    onError(error) {
      throw error;
    },
  });
  // Compiler output is `const _Vue = Vue; …; return function render(_ctx, _cache) {…}`.
  const render = new Function("Vue", code)(Vue) as (
    ctx: unknown,
    cache: unknown[],
  ) => Vue.VNodeChild;
  const setup = script
    ? (new Function(...Object.keys(helpers), "reply", script) as (
        ...args: unknown[]
      ) => Record<string, unknown>)
    : undefined;
  return Vue.defineComponent({
    name: "AgentWidgetBody",
    components,
    setup() {
      // `reply` is available to the template and the script alike; it only sends on a user's click.
      const reply = useWidgetReply();
      return { reply, ...setup?.(...Object.values(helpers), reply) };
    },
    render,
  });
}
