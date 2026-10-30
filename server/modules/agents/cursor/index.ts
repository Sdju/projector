import { createAcpBackend } from "../acp/index.ts";
import { askCursorQuestions } from "./questions.ts";

/** Cursor through its ACP mode (`agent acp`), with its own question request. */
export const cursorProgram = {
  id: "cursor",
  label: "Cursor",
  command: "agent",
  args: ["acp"],
  terminal: { executable: "agent" },
  extensions: { "cursor/ask_question": askCursorQuestions },
};

export const cursorBackend = createAcpBackend(cursorProgram);
