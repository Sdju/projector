import type { ClientAgent } from "../catalog/index.ts";
import { readProjectorPlan } from "./plan.ts";

/** The built-in agent: it answers in the chat but has no terminal program of its own. */
export const projectorAgent: ClientAgent = {
  backend: "projector",
  program: "projector",
  title: "Projector",
  caption: "Встроенный агент Projector, история разговоров",
  icon: "bot",
  builtin: true,
  plan: readProjectorPlan,
};
