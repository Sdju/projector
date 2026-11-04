import { createAcpBackend } from "../acp/index.ts";
import { createKimiDialect } from "./dialect.ts";

/** Kimi Code CLI through its ACP mode (`kimi acp`). */
export const kimiProgram = {
  id: "kimi",
  label: "Kimi",
  command: "kimi",
  args: ["acp"],
  dialect: createKimiDialect,
};

export const kimiBackend = createAcpBackend(kimiProgram);
