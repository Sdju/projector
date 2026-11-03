import type { Ref } from "vue";
import type {
  CommitComparison,
  PullRequestComparison,
} from "../../../../core/modules/workspace/index.ts";
import { workspaceRequest } from "../../workspace-api/index.ts";
import type { OpenFile } from "../open-file.ts";

export interface DiffOpenersContext {
  projectId: () => string;
  tabs: Ref<OpenFile[]>;
  selectTab(key: string): void;
  dropPreview(key: string): void;
  /** Current generation; a newer open makes an older response stale. */
  generation(): number;
  /** Starts a load and returns its generation. */
  begin(): number;
  finish(generation: number): void;
  /** Publishes a load error for the current generation and returns it. */
  fail(generation: number, message: string): number | undefined;
}

/**
 * Read-only diff tabs of the workspace: a commit against its parent and a merge request file
 * between the pinned base and head SHAs. Both are ordinary file tabs, so the agent can read them.
 */
export function createDiffOpeners(ctx: DiffOpenersContext) {
  async function openCommitFile(hash: string, path: string, preview = true) {
    const key = `${path}:commit:${hash}`;
    const existing = ctx.tabs.value.find((tab) => tab.key === key);
    if (existing) {
      if (!preview) existing.preview = false;
      ctx.selectTab(key);
      return ctx.generation();
    }
    const generation = ctx.begin();
    try {
      const data = await workspaceRequest<CommitComparison>(ctx.projectId(), "commit-diff", {
        hash,
        path,
      });
      if (generation !== ctx.generation()) return;
      if (preview) ctx.dropPreview(key);
      ctx.tabs.value.push({
        key,
        path,
        content: data.modified,
        original: data.original,
        commit: data.hash,
        parent: data.parent,
        preview,
      });
      ctx.selectTab(key);
      return generation;
    } catch (err) {
      return ctx.fail(
        generation,
        err instanceof Error ? err.message : "Не удалось открыть изменения",
      );
    } finally {
      ctx.finish(generation);
    }
  }

  async function openPullFile(number: number, path: string, head = "", preview = true) {
    // Opening a file must not replace the merge request preview tab that led to it.
    const pull = ctx.tabs.value.find(
      (tab) => tab.virtual === "pull" && Number(tab.params?.number) === number,
    );
    if (pull) pull.preview = false;
    const key = `${path}:pull:${number}${head ? `:${head}` : ""}`;
    const existing = ctx.tabs.value.find((tab) => tab.key === key);
    if (existing) {
      if (!preview) existing.preview = false;
      ctx.selectTab(key);
      return ctx.generation();
    }
    const generation = ctx.begin();
    try {
      const data = await workspaceRequest<PullRequestComparison>(ctx.projectId(), "pull-diff", {
        number: String(number),
        path,
      });
      if (generation !== ctx.generation()) return;
      if (data.binary) throw new Error("Бинарный файл нельзя сравнить как текст");
      if (data.tooLarge) throw new Error("Файл слишком большой для просмотра изменений");
      if (preview) ctx.dropPreview(key);
      ctx.tabs.value.push({
        key,
        path,
        content: data.modified,
        original: data.original,
        commit: data.hash,
        parent: data.parent,
        pull: number,
        preview,
      });
      ctx.selectTab(key);
      return generation;
    } catch (err) {
      return ctx.fail(
        generation,
        err instanceof Error ? err.message : "Не удалось открыть изменения",
      );
    } finally {
      ctx.finish(generation);
    }
  }

  return { openCommitFile, openPullFile };
}
