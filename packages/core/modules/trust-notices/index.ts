/**
 * A system notification about a trust decision that no longer matches the file on disk. Both a
 * local plugin package and a project file (appearance, roles, widgets, presets, devcontainer) are
 * inert after their content changes, so the inbox must say what stopped working and where to
 * confirm it again.
 */
export type TrustNoticeScope = "plugin" | "project";

export type TrustNoticeKind =
  | "plugin"
  | "appearance"
  | "roles"
  | "widgets"
  | "presets"
  | "devcontainer";

/** A project file kind that carries its own trust hash. */
export type ProjectTrustKind = Exclude<TrustNoticeKind, "plugin">;

export interface TrustNotice {
  /** Stable for one plugin or one project file; a different file gets a different id. */
  id: string;
  scope: TrustNoticeScope;
  kind: TrustNoticeKind;
  /** Plugin name or project name, shown next to the kind badge. */
  name: string;
  title: string;
  body: string;
  createdAt: number;
  /** Plugin package id. */
  plugin?: string;
  /** Project the notice belongs to; the page builds its route. */
  projectId?: string;
  projectPath?: string;
  /** Content hash that was current when the notice appeared; trust only if it still matches. */
  hash?: string;
  /** Settings section that resolves the notice; absent for the project page itself. */
  section?: string;
  /** Absolute page URL for notices that are not tied to a project (plugins). */
  href?: string;
}

export interface TrustNoticesPayload {
  notices: TrustNotice[];
}
