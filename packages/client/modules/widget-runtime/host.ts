import {
  computed,
  defineComponent,
  inject,
  effectScope,
  onBeforeUnmount,
  reactive,
  ref,
  setBlockTracking,
  watch,
  type Component,
  type EffectScope,
  type Ref,
  type VNodeChild,
} from "vue";
import { scriptHelpers, type RenderFn, type ScriptFn } from "./compile.ts";
import { useWidgetReply } from "./bridge.ts";
import { messageScopeKey } from "./scope.ts";

export interface WidgetHostInput {
  components: Record<string, Component>;
  /** Swapped as the message streams; the host and everything it mounted stay. */
  render: Ref<RenderFn | undefined>;
  script: Ref<ScriptFn | undefined>;
  /** The component is finished (and so is its message): an unknown name is an error, not a blank. */
  strict: Ref<boolean>;
  /** The script threw. */
  fail(error: unknown): void;
}

const GLOBALS = new Set(
  "Math JSON Number String Boolean Array Object Date RegExp Map Set Symbol BigInt Intl parseInt parseFloat isNaN isFinite NaN Infinity undefined console encodeURIComponent decodeURIComponent".split(
    " ",
  ),
);

/**
 * The one component a widget is mounted as for its whole life. Streaming does not replace it: the
 * script's state is made once, and only the render function changes, so Vue patches the DOM that
 * is there and widget state (typed text, a slider, a chosen tab) survives every chunk.
 */
export function createWidgetHost(input: WidgetHostInput): Component {
  return defineComponent({
    name: "AgentWidgetBody",
    components: input.components,
    setup() {
      const sendReply = useWidgetReply();
      const message = inject(messageScopeKey, null);
      // The component's own names (its script, `reply`) and, behind them, the message's shared ones.
      const state = reactive<Record<string, unknown>>({ reply: sendReply });
      const shared = message?.shared ?? {};
      const owns = (key: PropertyKey) => key in state || key in shared;
      const scope = new Proxy({} as Record<PropertyKey, unknown>, {
        has: (_, key) => owns(key),
        get: (_, key) => (key in state ? state[key as string] : shared[key as string]),
        set: (_, key, value) => {
          const target = key in state || !(key in shared) ? state : shared;
          target[key as string] = value;
          return true;
        },
      });
      const strict = computed(() => input.strict.value && (message?.done.value ?? true));
      const version = ref(0);
      let scriptScope: EffectScope | undefined;
      let lastGood: VNodeChild | undefined;
      watch(
        input.script,
        (script) => {
          scriptScope?.stop();
          scriptScope = effectScope(true);
          for (const key of Object.keys(state)) if (key !== "reply") delete state[key];
          try {
            if (script)
              Object.assign(
                state,
                scriptScope.run(() => script(...Object.values(scriptHelpers), sendReply, scope)),
              );
          } catch (error) {
            input.fail(error);
          }
          version.value++;
        },
        { immediate: true },
      );
      onBeforeUnmount(() => scriptScope?.stop());

      // Half a message: a name nothing has defined yet reads as empty instead of throwing.
      const loose = new Proxy(scope, {
        has: (_, key) =>
          owns(key) || (typeof key === "string" && key[0] !== "_" && !GLOBALS.has(key)),
        get: (target, key) => (owns(key) ? Reflect.get(target, key) : undefined),
      });
      const cache: unknown[] = [];
      return (): VNodeChild => {
        void version.value;
        const render = input.render.value;
        if (!render) return null;
        // Compiled blocks list their dynamic children, and Vue trusts that list when it patches. It
        // is the list of the previous template, so build the tree without blocks and Vue diffs it all.
        setBlockTracking(-1);
        try {
          if (strict.value) return render(scope, cache);
          return (lastGood = render(loose, cache));
        } catch (error) {
          // Half a message that still cannot render keeps what the last good render showed.
          if (strict.value) throw error;
          return lastGood ?? null;
        } finally {
          setBlockTracking(1);
        }
      };
    },
  });
}
