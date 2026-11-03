import { z } from "zod";

/**
 * Provider-neutral tool definition. Backends adapt it to their own tool API
 * (AI SDK `tool`, Claude Code MCP `tool`, ...), so a new Projector capability is written once.
 */
export interface ToolSpec {
  name: string;
  description: string;
  shape: z.ZodRawShape;
  run: (input: Record<string, unknown>) => unknown;
}

export function defineSpec<S extends z.ZodRawShape>(spec: {
  name: string;
  description: string;
  shape: S;
  run: (input: z.infer<z.ZodObject<S>>) => unknown;
}): ToolSpec {
  return { ...spec, run: (input) => spec.run(input as z.infer<z.ZodObject<S>>) };
}
