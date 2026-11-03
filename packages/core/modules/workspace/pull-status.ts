import type { PipelineTone } from "./pipeline-status.ts";

/** GitLab `detailed_merge_status` values; unknown codes stay as reported by the host. */
const MERGE_STATUS_LABEL: Record<string, string> = {
  mergeable: "можно вливать",
  checking: "проверяется",
  preparing: "готовится",
  ci_still_running: "pipeline идёт",
  ci_must_pass: "нужен успешный pipeline",
  status_checks_must_pass: "нужны status checks",
  approvals_syncing: "одобрения синхронизируются",
  not_approved: "нужно одобрение",
  blocked_status: "заблокирован",
  merge_request_blocked: "ждёт другой merge request",
  conflict: "конфликт",
  discussions_not_resolved: "обсуждения не решены",
  draft_status: "черновик",
  commits_status: "нет коммитов",
  merge_time: "время merge не наступило",
  requested_changes: "запрошены изменения",
  security_policy_violations: "нарушена security policy",
  jira_association_missing: "нет связи с Jira",
};

const DANGER = new Set([
  "conflict",
  "discussions_not_resolved",
  "draft_status",
  "not_approved",
  "requested_changes",
  "security_policy_violations",
]);

const WARNING = new Set([
  "checking",
  "preparing",
  "ci_still_running",
  "ci_must_pass",
  "status_checks_must_pass",
  "approvals_syncing",
  "blocked_status",
  "merge_request_blocked",
  "merge_time",
  "jira_association_missing",
]);

/** Short Russian label of a merge readiness code; unknown codes are returned unchanged. */
export function mergeStatusLabel(value: string) {
  if (!value) return "";
  return MERGE_STATUS_LABEL[value] ?? value;
}

export function mergeStatusTone(value: string): PipelineTone {
  if (value === "mergeable") return "success";
  if (DANGER.has(value)) return "danger";
  if (WARNING.has(value)) return "warning";
  return "muted";
}
