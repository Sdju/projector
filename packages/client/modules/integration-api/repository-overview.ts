/** Neutral shape of the "About repository" tab; GitHub and GitLab map their own payloads into it. */
export type RepositoryStatIcon = "star" | "fork" | "eye" | "issue" | "merge";

export interface RepositoryStat {
  key: string;
  label: string;
  value: number;
  icon: RepositoryStatIcon;
}

export interface RepositoryDetail {
  key: string;
  label: string;
  value: string;
}

export interface RepositoryOverviewModel {
  name: string;
  namespace?: string;
  fullName: string;
  avatarUrl?: string;
  description?: string | null;
  private: boolean;
  /** Host-provided visibility label; the Russian fallback is built from `private`. */
  visibility?: string;
  archived?: boolean;
  empty?: boolean;
  htmlUrl: string;
  /** Host name for the external link: GitHub or GitLab. */
  hostLabel: string;
  topics: string[];
  stats: RepositoryStat[];
  details: RepositoryDetail[];
  homepage?: string;
  license?: string;
  /** Snapshot hint under the details; `code` is rendered in monospace, `suffix` follows it. */
  refNote?: { text: string; code?: string; suffix?: string };
  /** What the agent reads in the tab, already formatted. */
  readout: { note: string; text: string };
}
