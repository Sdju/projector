import { defineComponent, h, shallowRef, type PropType } from "@vue/runtime-core";
import type { VioElement } from "./core.ts";
import type { EntryWidget } from "./types.ts";

export function defineWidgetComponent(name: string, type: string) {
  return defineComponent({
    name, inheritAttrs: false,
    setup(_props, { attrs, slots, expose }) {
      const element = shallowRef<VioElement | null>(null);
      expose({ element, get widget() { return element.value?.widget ?? null; } });
      return () => h(type, { ...attrs, ref: element }, slots.default?.());
    },
  });
}
export const VWindow = defineWidgetComponent("VWindow", "window");
export const VBox = defineWidgetComponent("VBox", "box");
export const VLabel = defineWidgetComponent("VLabel", "label");
export const VButton = defineWidgetComponent("VButton", "button");
export const VImage = defineWidgetComponent("VImage", "image");
export const VListBox = defineWidgetComponent("VListBox", "list-box");
export const VListBoxRow = defineWidgetComponent("VListBoxRow", "list-box-row");
export const VScrolledWindow = defineWidgetComponent("VScrolledWindow", "scrolled-window");
export const VGrid = defineWidgetComponent("VGrid", "grid");
export const VStack = defineWidgetComponent("VStack", "stack");
export const VSeparator = defineWidgetComponent("VSeparator", "separator");
export const VSpinner = defineWidgetComponent("VSpinner", "spinner");
export const VSwitch = defineWidgetComponent("VSwitch", "switch");
export const VCheckButton = defineWidgetComponent("VCheckButton", "check-button");
export const VKeyController = defineWidgetComponent("VKeyController", "key-controller");

export const VEntry = defineComponent({
  name: "VEntry", inheritAttrs: false,
  props: { modelValue: { type: String as PropType<string | undefined>, default: undefined } },
  emits: ["update:modelValue"],
  setup(props, { attrs, expose, emit }) {
    const element = shallowRef<VioElement | null>(null);
    expose({ element, get widget() { return element.value?.widget ?? null; } });
    return () => h("entry", {
      ...attrs, ref: element,
      ...(props.modelValue === undefined ? {} : { text: props.modelValue }),
      onChanged: (...args: unknown[]) => {
        const entry = element.value?.widget as EntryWidget | undefined;
        if (props.modelValue !== undefined && entry && entry.getText() !== props.modelValue) emit("update:modelValue", entry.getText());
        const handlers = Array.isArray(attrs.onChanged) ? attrs.onChanged : [attrs.onChanged];
        for (const handler of handlers) if (typeof handler === "function") handler(...args);
      },
    });
  },
});
