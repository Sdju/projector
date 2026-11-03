<script lang="ts">
import {
  defineComponent,
  getCurrentInstance,
  h,
  inject,
  shallowRef,
  vModelDynamic,
  withDirectives,
  type ObjectDirective,
  type PropType,
} from "vue";
import { controlScopeKey } from "../utilities/control-scope.ts";

/** Public ref API; render-function setup does not infer expose() in InstanceType. */
export interface UiControlHandle {
  readonly element: HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement | undefined;
  focus(options?: FocusOptions): void;
  select(): void;
}

export default defineComponent({
  props: {
    as: { type: String as PropType<"input" | "select" | "textarea">, default: "input" },
    modelValue: null,
    value: null,
    modelModifiers: { type: Object, default: () => ({}) },
    mono: Boolean,
    grow: Boolean,
    appearance: String as PropType<"inset" | "filled" | "swatch" | "inline-select">,
    swatchSize: String as PropType<"sm" | "md">,
  },
  emits: ["update:modelValue"],
  setup(props, { attrs, emit, slots, expose }) {
    const scope = inject(controlScopeKey, undefined);
    const instance = getCurrentInstance()!;
    const element = shallowRef<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>();
    const hasModel = () =>
      Object.hasOwn(instance.vnode.props ?? {}, "modelValue") ||
      Object.hasOwn(instance.vnode.props ?? {}, "model-value");
    let initialized = false;
    // Unmodeled controls retain native value/checked/selected and native events. If a model
    // is added later, initialize Vue's listeners once without replacing the focused element.
    const nativeModel: ObjectDirective = {
      deep: true,
      created(...args) {
        initialized = false;
        if (hasModel()) {
          vModelDynamic.created?.(...args);
          initialized = true;
        }
      },
      mounted(...args) {
        if (hasModel()) vModelDynamic.mounted?.(...args);
      },
      beforeUpdate(...args) {
        if (!hasModel()) return;
        if (!initialized) {
          vModelDynamic.created?.(args[0], args[1], args[2], null);
          initialized = true;
        }
        vModelDynamic.beforeUpdate?.(...args);
      },
      updated(...args) {
        if (hasModel()) vModelDynamic.updated?.(...args);
      },
    };
    const handle: UiControlHandle = {
      get element() {
        return element.value;
      },
      focus(options?: FocusOptions) {
        element.value?.focus(options);
      },
      select() {
        const control = element.value;
        if (control instanceof HTMLInputElement || control instanceof HTMLTextAreaElement)
          control.select();
      },
    };
    expose(handle);
    // Vue owns composition, native option values, lazy/trim/number and selection updates.
    // Keep a single native root so labels, validation, form data and scoped CSS still work.
    return () =>
      withDirectives(
        h(
          props.as,
          {
            ref: element,
            ...(props.value === undefined ? {} : { value: props.value }),
            class: {
              "ui-control-mono": props.mono,
              "ui-control-grow": props.grow,
              "ui-control-inset": props.appearance === "inset",
              "ui-control-filled": props.appearance === "filled",
              "ui-control-swatch": props.appearance === "swatch" && attrs.type === "color",
              "ui-control-swatch-compact": props.swatchSize === "sm",
              "ui-control-inline-select":
                props.appearance === "inline-select" && props.as === "select",
            },
            style:
              props.as !== "textarea" && !["checkbox", "radio"].includes(String(attrs.type))
                ? scope?.value
                : undefined,
            "onUpdate:modelValue": (value: unknown) => {
              if (hasModel()) emit("update:modelValue", value);
            },
          },
          slots.default?.(),
        ),
        [[nativeModel, props.modelValue, undefined, props.modelModifiers]],
      );
  },
});
</script>

<style scoped>
.ui-control-mono {
  font-family: var(--mono);
}

.ui-control-inset:is(input, select, textarea) {
  padding: 3px 8px;
  font-size: var(--fs-xs);
  color: var(--text);
  background: var(--bg-sunken);
  border: 1px solid var(--line);
  border-radius: var(--r-sm);
}
.ui-control-filled {
  background: var(--bg-2);
  border: 1px solid var(--line);
  color: var(--text);
  border-radius: var(--r-sm);
  padding: var(--sp-2);
  padding-right: var(--ui-control-padding-right, var(--sp-2));
  min-width: 0;
}
.ui-control-grow {
  flex: 1;
  min-width: 0;
}
.ui-control-swatch:is(input[type="color"]) {
  width: 28px;
  height: var(--ui-control-swatch-height, 26px);
  padding: 2px;
  background: transparent;
  cursor: pointer;
}
.ui-control-swatch-compact {
  --ui-control-swatch-height: 24px;
}
.ui-control-inline-select {
  width: auto;
  padding-block: var(--sp-1);
}
</style>
