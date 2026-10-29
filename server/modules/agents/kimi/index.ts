import { createAcpBackend } from "../acp/index.ts";

/** Kimi Code CLI through its ACP mode (`kimi acp`). */
export const kimiProgram = {
  id: "kimi",
  label: "Kimi",
  command: "kimi",
  args: ["acp"],
};

export const kimiBackend = createAcpBackend(kimiProgram);
