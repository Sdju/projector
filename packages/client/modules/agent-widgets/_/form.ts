import { inject, onBeforeUnmount, reactive, ref, type InjectionKey, type Ref } from "vue";
import type { FormPreset } from "../../widget-runtime/index.ts";

/**
 * A form is a set of named controls that need no script: each control registers its value here,
 * and `<Button submit|reset|preset>` read and change them. Values are plain JSON.
 */
export interface FormContext {
  /** Set once the form has been submitted: its controls lock and its buttons show it. */
  sent: Ref<boolean>;
  /** Validation messages by field name, filled by `validate()`. */
  errors: Record<string, string>;
  register(
    name: string,
    value: Ref<unknown>,
    initial: unknown,
    validate?: (value: unknown) => string | undefined,
  ): () => void;
  values(): Record<string, unknown>;
  reset(): void;
  set(values: Record<string, unknown>): void;
  validate(): boolean;
}
export const formKey: InjectionKey<FormContext> = Symbol("agent-widget-form");

const clone = <T>(value: T): T => (value === undefined ? value : JSON.parse(JSON.stringify(value)));

export function createForm(preset?: FormPreset | null): FormContext {
  const fields = new Map<
    string,
    { value: Ref<unknown>; initial: unknown; validate?: (value: unknown) => string | undefined }
  >();
  const errors = reactive<Record<string, string>>({});
  const clear = () => {
    for (const key of Object.keys(errors)) delete errors[key];
  };
  return {
    sent: ref(false),
    errors,
    register(name, value, initial, validate) {
      const field = { value, initial: clone(initial), validate };
      // A snapshot shows the answer that was actually sent, not the defaults the agent wrote.
      const submitted = preset?.values?.[name];
      if (submitted !== undefined) value.value = clone(submitted);
      fields.set(name, field);
      return () => {
        if (fields.get(name) !== field) return;
        fields.delete(name);
        delete errors[name];
      };
    },
    values: () =>
      Object.fromEntries([...fields].map(([name, field]) => [name, clone(field.value.value)])),
    reset() {
      for (const field of fields.values()) field.value.value = clone(field.initial);
      clear();
    },
    set(values) {
      for (const [name, value] of Object.entries(values))
        if (fields.has(name)) fields.get(name)!.value.value = clone(value);
      clear();
    },
    validate() {
      clear();
      for (const [name, field] of fields) {
        const message = field.validate?.(field.value.value);
        if (message) errors[name] = message;
      }
      return Object.keys(errors).length === 0;
    },
  };
}

/**
 * Seeds a control's value (when its parent does not drive it with v-model) and, inside a form,
 * registers it under `name`. The optional validator runs when the form is submitted.
 */
export function useField<T>(
  name: string | undefined,
  model: Ref<T | undefined>,
  initial: T,
  validate?: (value: T) => string | undefined,
) {
  if (model.value === undefined) model.value = clone(initial);
  const form = inject(formKey, null);
  if (form && name)
    onBeforeUnmount(
      form.register(
        name,
        model as Ref<unknown>,
        model.value,
        validate ? (value) => validate(value as T) : undefined,
      ),
    );
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
