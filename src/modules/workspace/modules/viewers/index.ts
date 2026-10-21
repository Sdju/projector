import { defineAsyncComponent } from "vue";
export { default as ArchiveViewer } from "./ui/ArchiveViewer.vue";
export { default as CommitOverview } from "./ui/CommitOverview.vue";
export { default as ImageViewport } from "./ui/ImageViewport.vue";
export const IssueView = defineAsyncComponent(() => import("./ui/IssueView.vue"));
export const PullRequestView = defineAsyncComponent(() => import("./ui/PullRequestView.vue"));
export const DiscussionView = defineAsyncComponent(() => import("./ui/DiscussionView.vue"));
export const CodeViewer = defineAsyncComponent(() => import("./ui/CodeViewer.vue"));
export const MarkdownViewer = defineAsyncComponent(() => import("./ui/MarkdownViewer.vue"));
export const SvgViewer = defineAsyncComponent(() => import("./ui/SvgViewer.vue"));
export const HtmlViewer = defineAsyncComponent(() => import("./ui/HtmlViewer.vue"));
export const EditorSettings = defineAsyncComponent(() => import("./ui/EditorSettings.vue"));
export { default as EditorStatusLine } from "./ui/EditorStatusLine.vue";
export { default as EditorTopbarActions } from "./ui/EditorTopbarActions.vue";
export { provideEditorTopbar } from "./lib/editor-topbar.ts";
export {
  provideEditorStatus,
  useEditorStatusStore,
  type EditorStatus,
  type EditorStatusStore,
  type LineEnding,
} from "./lib/editor-status.ts";
