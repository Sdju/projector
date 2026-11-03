import { z } from "zod";

const fileScopeSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("live") }),
  z.object({ kind: z.literal("commit"), rev: z.string() }),
  z.object({ kind: z.literal("compare"), from: z.string(), to: z.string() }),
]);

const sidebarSectionSchema = z.object({
  id: z.string(),
  title: z.string(),
  source: z.string().optional(),
  group: z.string().optional(),
  /** View kind: a snapshot tree or a comparison. */
  kind: z.string().optional(),
  params: z.record(z.string(), z.unknown()).optional(),
  closable: z.boolean().optional(),
});

const tabSchema = z.object({
  key: z.string(),
  path: z.string(),
  virtual: z.string().optional(),
  params: z.record(z.string(), z.unknown()).optional(),
  commit: z.string().optional(),
  pull: z.number().int().positive().optional(),
  /** Saved before file scopes existed; converted to a commit scope on restore. */
  rev: z.string().optional(),
  scope: fileScopeSchema.optional(),
  originalPath: z.string().optional(),
  external: z.boolean().optional(),
  staged: z.boolean().optional(),
  markdownMode: z.enum(["document", "source"]).optional(),
});
export const workspaceSessionSchema = z.object({
  tabs: z.array(tabSchema),
  /** Temporary sidebar sections and their scopes; restored together with their tabs. */
  sections: z.array(sidebarSectionSchema).optional(),
  activeKey: z.string(),
  section: z.string(),
  /** Открытая мобильная поверхность; на десктопе не используется. */
  mobileSurface: z.enum(["editor", "files", "terminal"]).optional(),
  treeWidth: z.number().finite().positive().optional(),
  agentWidth: z.number().finite().positive().optional(),
  sidebarHidden: z.boolean().optional(),
  /** Раскладка блоков; читается через `parseDockLayout`, который сам отбрасывает повреждённые данные. */
  layout: z.unknown().optional(),
});
export type WorkspaceSession = z.infer<typeof workspaceSessionSchema>;
