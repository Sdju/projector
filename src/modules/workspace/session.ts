import { z } from "zod";

const tabSchema = z.object({
  key: z.string(),
  path: z.string(),
  virtual: z.enum(["keybindings", "agent", "project", "commit", "network", "docker"]).optional(),
  commit: z.string().optional(),
  external: z.boolean().optional(),
  staged: z.boolean().optional(),
  markdownMode: z.enum(["document", "source"]).optional(),
});
export const workspaceSessionSchema = z.object({
  tabs: z.array(tabSchema),
  activeKey: z.string(),
  section: z.enum(["files", "search", "git", "project", "docker"]),
  treeWidth: z.number().finite().positive().optional(),
  agentWidth: z.number().finite().positive().optional(),
  sidebarHidden: z.boolean().optional(),
  /** Раскладка блоков; читается через `parseDockLayout`, который сам отбрасывает повреждённые данные. */
  layout: z.unknown().optional(),
});
export type WorkspaceSession = z.infer<typeof workspaceSessionSchema>;
