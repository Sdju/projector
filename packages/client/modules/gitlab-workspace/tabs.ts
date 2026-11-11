import { defineTab, idTab, numberedTab } from "../workspace-api/index.ts";

export const issueTab = numberedTab("issue", "Issue");
export const pullTab = numberedTab("pull", "MR");
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
