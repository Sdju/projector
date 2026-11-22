import type { WorkspaceCapability } from "../../../../workspace-api/index.ts";
import { registerReviewCommands } from "./review-commands.ts";
import { useReviewSession } from "./review-session.ts";

/** Starts the review session of a workspace and registers `ide.review.*` on its editor scope. */
export function connectReviewWorkspace(options: {
  projectId: string;
  register: (
    id: string,
    title: string,
    run: (args?: unknown) => unknown,
    enabled: (args?: unknown) => boolean,
    requires?: WorkspaceCapability,
    meta?: { description?: string; arguments?: Record<string, string> },
  ) => unknown;
  run: (id: string, args?: unknown) => Promise<unknown>;
  openTab: () => void;
  openFile: (path: string, from: number, to: number, staged?: boolean) => unknown;
}) {
  const review = useReviewSession(() => options.projectId, {
    openTab: () => void options.run("ide.review.open"),
    sendToChat: () => options.run("ide.review.toChat"),
  });
  registerReviewCommands({ ...options, review });
  return review;
}
