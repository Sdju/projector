import type { AcpFormAdapter, AcpFormField, AcpFormOption } from "../acp/index.ts";

const record = (value: unknown): Record<string, unknown> =>
  value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};

/** The metadata Codex puts on a form property. */
const codexMeta = (field: AcpFormField): Record<string, unknown> =>
  record(record(field.schema._meta).codex);

const strippedKey = (key: string) => key.replace(/_(custom|note)\d*$/, "");

/**
 * Codex's own shape of `elicitation/create`: it marks the note that takes the user's own words
 * with `_meta.codex` and lists a "none of the above" option next to it.
 */
export const codexForms: AcpFormAdapter = {
  companion(field, properties) {
    if (codexMeta(field).role === "user_note") return true;
    return strippedKey(field.key) !== field.key && strippedKey(field.key) in properties;
  },
  baseOf(field) {
    const questionId = codexMeta(field).questionId;
    return typeof questionId === "string" ? questionId : undefined;
  },
  fallbackOption(options: AcpFormOption[]) {
    return options.find((option) => option.id === "None of the above");
  },
};
