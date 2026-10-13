import type { AgentRunOptions } from "./backend.ts";
import type { AgentQuestion } from "./command-bridge.ts";

type Schema = Record<string, unknown>;

interface Field {
  question: AgentQuestion;
  type: "string" | "number" | "integer" | "boolean" | "array";
  /** The field that takes the user's own words next to the options (`<id>_note`, `<id>_custom`). */
  companion?: string;
  /** The option the agent reads as "none of these" when only the companion holds the answer. */
  fallback?: string;
}

const record = (value: unknown): Schema =>
  value && typeof value === "object" && !Array.isArray(value) ? (value as Schema) : {};
const text = (value: unknown, limit: number) =>
  typeof value === "string" ? value.slice(0, limit) : "";

/** Choices of a property: `oneOf`/`anyOf` entries with `const`/`title`, or a plain `enum`. */
function choices(schema: Schema): { id: string; label: string; description?: string }[] {
  const entries = [schema.oneOf, schema.anyOf].find(Array.isArray) as unknown[] | undefined;
  if (entries)
    return entries.slice(0, 50).flatMap((entry) => {
      const item = record(entry);
      const id = text(item.const, 500);
      if (!id) return [];
      const description = text(item.description, 1000);
      return [{ id, label: text(item.title, 500) || id, ...(description ? { description } : {}) }];
    });
  if (Array.isArray(schema.enum))
    return schema.enum.slice(0, 50).flatMap((value) => {
      const id = text(value, 500);
      return id ? [{ id, label: id }] : [];
    });
  return [];
}

const isCompanion = (key: string, schema: Schema, properties: Schema) => {
  if (record(record(schema._meta).codex).role === "user_note") return true;
  return /_(custom|note)\d*$/.test(key) && key.replace(/_(custom|note)\d*$/, "") in properties;
};

/** The questions of an ACP form (`elicitation/create`, mode `form`). */
function fieldsOf(requestedSchema: unknown): Field[] {
  const properties = record(record(requestedSchema).properties);
  const required = new Set(
    Array.isArray(record(requestedSchema).required)
      ? (record(requestedSchema).required as unknown[])
      : [],
  );
  const companions = new Map<string, string>();
  for (const [key, value] of Object.entries(properties)) {
    if (!isCompanion(key, record(value), properties)) continue;
    const meta = record(record(record(value)._meta).codex);
    const base =
      typeof meta.questionId === "string" ? meta.questionId : key.replace(/_(custom|note)\d*$/, "");
    if (base in properties) companions.set(base, key);
  }
  const companionKeys = new Set(companions.values());
  return Object.entries(properties)
    .slice(0, 20)
    .flatMap(([key, raw]) => {
      if (companionKeys.has(key)) return [];
      const schema = record(raw);
      const array = schema.type === "array";
      let options = choices(array ? record(schema.items) : schema);
      const type = (["string", "number", "integer", "boolean", "array"] as const).find(
        (item) => item === schema.type,
      );
      if (!type) return [];
      if (type === "boolean")
        options = [
          { id: "true", label: "Да" },
          { id: "false", label: "Нет" },
        ];
      const title = text(schema.title, 2000) || text(schema.description, 2000) || key;
      const description = text(schema.description, 300);
      const companion = companions.get(key);
      // Codex lists a "none of these" option that goes with the companion's text.
      const fallback = companion
        ? options.find((option) => option.id === "None of the above")
        : undefined;
      return [
        {
          type,
          ...(companion ? { companion } : {}),
          ...(fallback ? { fallback: fallback.id } : {}),
          question: {
            id: key,
            question: title,
            ...(description && description !== title ? { header: description } : {}),
            options: options.filter((option) => option.id !== fallback?.id),
            multiple: array,
            // Free text where there are no options, or where the agent made room for it.
            custom: !options.length || !!companion,
            optional: !required.has(key),
          },
        },
      ];
    });
}

/**
 * Answers a form the agent opened (`elicitation/create`): Codex's and OpenCode's question tools
 * and MCP servers' forms. Without the capability or a user, the agent is told nothing was answered.
 */
export async function elicitForm(
  options: AgentRunOptions,
  params: Record<string, unknown>,
): Promise<unknown> {
  if (params.mode !== "form") return { action: "cancel" };
  const fields = fieldsOf(params.requestedSchema);
  if (!options.ask || !fields.length) return { action: "cancel" };
  const message = text(params.message, 300);
  const answer = await options
    .ask({
      ...(message ? { title: message } : {}),
      questions: fields.map((field) => field.question),
      custom: false,
    })
    .catch(() => undefined);
  if (answer === undefined) return { action: "cancel" };
  if (answer === null) return { action: "decline" };
  const content: Record<string, unknown> = {};
  for (const field of fields) {
    const given = answer[field.question.id] ?? [];
    const known = new Set(field.question.options.map((option) => option.id));
    const picked = given.filter((value) => known.has(value));
    const own = given
      .filter((value) => !known.has(value) && value.trim())
      .join("\n")
      .trim();
    if (field.type === "array") {
      if (picked.length) content[field.question.id] = picked;
      if (own && field.companion) content[field.companion] = own;
    } else if (field.question.options.length) {
      if (picked[0] !== undefined)
        content[field.question.id] = field.type === "boolean" ? picked[0] === "true" : picked[0];
      else if (own && field.companion) {
        content[field.companion] = own;
        if (field.fallback) content[field.question.id] = field.fallback;
      }
    } else if (own) {
      const value = field.type === "string" ? own : Number(own);
      content[field.question.id] = Number.isNaN(value) ? own : value;
    }
  }
  return { action: "accept", content };
}
