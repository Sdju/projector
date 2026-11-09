import { guiCommand } from "../../agent-core/index.ts";

/** Opens another agent's chat from inside a chat; the workspace owns the tab. */
export function openAgentChat(
  api: {
    executeCommand(id: string, args?: unknown, options?: { scope?: string }): Promise<unknown>;
  },
  projectId: string,
  program: string,
  fail: (message: string) => void,
): void {
  void api
    .executeCommand(guiCommand(program), undefined, { scope: `editor:${projectId}` })
    .catch((cause) => fail(cause instanceof Error ? cause.message : "Не удалось открыть агента"));
}
