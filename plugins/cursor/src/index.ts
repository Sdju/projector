import type { AcpProgram, AgentBackend, PluginCodeApi } from "./api.ts";
import { createCursorDialect } from "./dialect.ts";
import { showCursorImage } from "./images.ts";
import { createCursorPlan } from "./plan.ts";
import { askCursorQuestions } from "./questions.ts";
import { normalizeCursorSelection } from "./selection.ts";
import { reportCursorTask } from "./task.ts";
import { updateCursorTodos } from "./todos.ts";

/** Cursor through its ACP mode (`agent acp`), with its own picker flag, questions and plan. */
export function cursorProgram(api: PluginCodeApi): AcpProgram {
  return {
    id: "cursor",
    label: "Cursor",
    command: "agent",
    args: ["acp"],
    terminal: { executable: "agent" },
    dialect: () => createCursorDialect(api),
    clientCapabilities: {
      subagents: {},
      _meta: { parameterizedModelPicker: true },
    },
    normalizeSelection: normalizeCursorSelection,
    extensions: {
      "cursor/ask_question": askCursorQuestions,
      "cursor/create_plan": createCursorPlan,
      "cursor/update_todos": updateCursorTodos,
      "cursor/task": reportCursorTask,
      "cursor/generate_image": showCursorImage,
    },
  };
}

/** The agents this plugin adds to Projector; loaded in-process after the user trusts the package. */
export function createAgents(api: PluginCodeApi): AgentBackend[] {
  return [api.createAcpBackend(cursorProgram(api))];
}
