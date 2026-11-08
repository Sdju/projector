import { answerWidgetNames, isWidgetName } from "./registry.ts";
import { splitMessage } from "./split.ts";

const opens = (name: string) => new RegExp(`<${name}(?=[\\s/>])`);

/**
 * The block that should replace the composer for the next answer. Only a finished answer whose
 * last meaningful block can be answered counts: a form in the middle of a report stays a report.
 * A layout around the form (`<Card><Form>…`) is kept as it is, so its title and hint survive.
 */
export function answerFormSource(text: string, projectId?: string): string | undefined {
  const names = answerWidgetNames(projectId);
  if (!names.length) return undefined;
  const parts = splitMessage(text, {
    known: (name) => isWidgetName(name, projectId),
    streaming: false,
  });
  const last = parts
    .filter((part) => part.type !== "script" && (part.type !== "markdown" || part.text.trim()))
    .at(-1);
  if (last?.type !== "widget" || !last.complete) return undefined;
  return names.some((name) => opens(name).test(last.source)) ? last.source : undefined;
}
