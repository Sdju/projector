import { defineTab } from "../workspace-api/index.ts";

const numberedTab = (id: string, label: string) =>
  defineTab<{ number: number; title?: string }>({
    id,
    key: ({ number }) => `${id}:${number}`,
    path: ({ number }) => `${label} #${number}`,
    title: ({ number, title }) => `${title ? `${title} · ` : ""}${label} #${number}`,
    hint: ({ title }) => title ?? "",
    preview: true,
  });

const idTab = (kind: string, label: string) =>
  defineTab<{ id: number; title?: string }>({
    id: kind,
    key: ({ id }) => `${kind}:${id}`,
    path: ({ id }) => `${label} #${id}`,
    title: ({ id, title }) => `${title ? `${title} · ` : ""}${label} #${id}`,
    hint: ({ title }) => title ?? "",
    preview: true,
  });

export const issueTab = numberedTab("issue", "Issue");
export const pullTab = numberedTab("pull", "PR");
export const discussionTab = numberedTab("discussion", "Discussion");
export const pipelineTab = idTab("pipeline", "Pipeline");
export const jobTab = idTab("job", "Job");
export const releaseTab = defineTab<{ tag: string; title?: string }>({
  id: "release",
  key: ({ tag }) => `release:${tag}`,
  path: ({ tag }) => `Release ${tag}`,
  title: ({ tag, title }) => `${title ? `${title} · ` : ""}Release ${tag}`,
  hint: ({ title }) => title ?? "",
  preview: true,
});
