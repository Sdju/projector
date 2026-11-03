import type { InjectionKey, Ref } from "vue";

/**
 * How a form is shown outside an answer: the chat's active input or a submitted snapshot. The
 * wrapper provides this above a widget host; `<Form>` and `<Button>` read it.
 */
export interface FormPreset {
  /** Controls are shown but cannot be changed. May follow the edit state of a snapshot. */
  readonly?: Ref<boolean> | boolean;
  /** Values to show instead of the form's own initials: the answer the user already sent. */
  values?: Record<string, unknown>;
}

export const formPresetKey: InjectionKey<FormPreset> = Symbol("agent-widget-form-preset");

/** The surrounding panel can own submission: the composer's send button is the only visible one. */
export interface FormChrome {
  composer?: boolean;
  registerSubmit?: (submit: () => boolean | void) => () => void;
}
export const formChromeKey: InjectionKey<FormChrome> = Symbol("agent-widget-form-chrome");
