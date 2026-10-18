import {
  effectScope,
  onBeforeUnmount,
  provide,
  reactive,
  ref,
  watch,
  type EffectScope,
  type InjectionKey,
  type Ref,
} from "vue";
import { useWidgetReply } from "./bridge.ts";
import { compileScript, scriptHelpers } from "./compile.ts";
import type { MessagePart } from "./split.ts";

/**
 * What the components of one message share: the values its `<script>`s outside any component
 * returned (a slider in one block can drive a chart in another), and whether the message is over.
 */
export interface MessageScope {
  shared: Record<string, unknown>;
  /** The message is finished: only now is a name nobody defined an error rather than "not yet". */
  done: Ref<boolean>;
  /** Counts script runs: a component that failed for a missing name tries again after one. */
  version: Ref<number>;
}
export const messageScopeKey: InjectionKey<MessageScope> = Symbol("agent-message-scope");

/** Runs each finished `<script>` part once (again only if its text changes) into the shared scope. */
export function useMessageScope(
  parts: Ref<MessagePart[]>,
  done: Ref<boolean>,
  errors: Ref<string[]>,
): void {
  const shared = reactive<Record<string, unknown>>({});
  const reply = useWidgetReply();
  const ran = new Map<number, { code: string; scope: EffectScope }>();
  const version = ref(0);
  provide(messageScopeKey, { shared, done, version });
  watch(
    parts,
    (list) => {
      list.forEach((part, index) => {
        if (part.type !== "script" || !part.complete) return;
        const before = ran.get(index);
        if (before?.code === part.source) return;
        before?.scope.stop();
        const scope = effectScope(true);
        ran.set(index, { code: part.source, scope });
        try {
          const returned = scope.run(() =>
            compileScript(part.source)(...Object.values(scriptHelpers), reply, shared),
          );
          Object.assign(shared, returned);
          version.value++;
        } catch (error) {
          errors.value = [...errors.value, error instanceof Error ? error.message : String(error)];
        }
      });
    },
    { immediate: true },
  );
  onBeforeUnmount(() => ran.forEach(({ scope }) => scope.stop()));
}
