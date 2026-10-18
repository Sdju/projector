import { inject, onBeforeUnmount, ref, type InjectionKey, type Ref } from "vue";

/**
 * A form is a set of named controls that need no script: each control registers its value here,
 * and `<Button submit|reset|preset>` read and change them. Values are plain JSON.
 */
export interface FormContext {
  /** Set once the form has been submitted: its controls lock and its buttons show it. */
  sent: Ref<boolean>;
  register(name: string, value: Ref<unknown>, initial: unknown): () => void;
  values(): Record<string, unknown>;
  reset(): void;
  set(values: Record<string, unknown>): void;
}
export const formKey: InjectionKey<FormContext> = Symbol("agent-widget-form");

const clone = <T>(value: T): T => (value === undefined ? value : JSON.parse(JSON.stringify(value)));

export function createForm(): FormContext {
  const fields = new Map<string, { value: Ref<unknown>; initial: unknown }>();
  return {
    sent: ref(false),
    register(name, value, initial) {
      const field = { value, initial: clone(initial) };
      fields.set(name, field);
      return () => {
        if (fields.get(name) === field) fields.delete(name);
      };
    },
    values: () =>
      Object.fromEntries([...fields].map(([name, field]) => [name, clone(field.value.value)])),
    reset() {
      for (const field of fields.values()) field.value.value = clone(field.initial);
    },
    set(values) {
      for (const [name, value] of Object.entries(values))
        if (fields.has(name)) fields.get(name)!.value.value = clone(value);
    },
  };
}

/**
 * Seeds a control's value (when its parent does not drive it with v-model) and, inside a form,
 * registers it under `name`. Returns the form's lock state for the control to disable itself.
 */
export function useField<T>(name: string | undefined, model: Ref<T | undefined>, initial: T) {
  if (model.value === undefined) model.value = clone(initial);
  const form = inject(formKey, null);
  if (form && name) onBeforeUnmount(form.register(name, model as Ref<unknown>, model.value));
}

export interface WidgetOption {
  value: string;
  label?: string;
  hint?: string;
}

/** Models pass options either as strings or as `{ value, label?, hint? }`; both are fine. */
export function normalizeOptions(options: (string | WidgetOption)[] | undefined): WidgetOption[] {
  return (options ?? []).map((option) =>
    typeof option === "string" ? { value: option } : { ...option, value: String(option.value) },
  );
}
