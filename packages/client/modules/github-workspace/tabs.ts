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

export const issueTab = numberedTab("issue", "Issue");
export const pullTab = numberedTab("pull", "PR");
export const discussionTab = numberedTab("discussion", "Discussion");
export const pipelineTab = numberedTab("pipeline", "Pipeline");
export const jobTab = numberedTab("job", "Job");
export const releaseTab = defineTab<{ tag: string; title?: string }>({
  id: "release",
  key: ({ tag }) => `release:${tag}`,
  path: ({ tag }) => `Release ${tag}`,
  title: ({ tag, title }) => `${title ? `${title} · ` : ""}Release ${tag}`,
  hint: ({ title }) => title ?? "",
  preview: true,
});
