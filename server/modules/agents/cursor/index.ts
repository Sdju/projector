import { createAcpBackend } from "../acp/index.ts";
import { createCursorDialect } from "./dialect.ts";
import { showCursorImage } from "./images.ts";
import { createCursorPlan } from "./plan.ts";
import { askCursorQuestions } from "./questions.ts";
import { normalizeCursorSelection } from "./selection.ts";
import { reportCursorTask } from "./task.ts";
import { updateCursorTodos } from "./todos.ts";

/** Cursor through its ACP mode (`agent acp`), with its own picker flag, questions and plan. */
export const cursorProgram = {
  id: "cursor",
  label: "Cursor",
  command: "agent",
  args: ["acp"],
  terminal: { executable: "agent" },
  dialect: createCursorDialect,
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

export const cursorBackend = createAcpBackend(cursorProgram);
