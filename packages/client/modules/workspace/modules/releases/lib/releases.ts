import { ref, type Ref } from "vue";
import type { Release, ReleaseList } from "@projector/core/modules/workspace/index.ts";
import { workspaceRequest } from "../../../../workspace-api/index.ts";

/** Release list of one repository with numbered pages, newest first. */
export function useReleases(projectId: () => string) {
  const items = ref<Release[]>([]) as Ref<Release[]>;
  const next = ref<number | null>(null);
  const latestTag = ref("");
  const loading = ref(false);
  const loadingMore = ref(false);
  const error = ref("");
  let generation = 0;
  const page = (cursor: number) =>
    workspaceRequest<ReleaseList>(projectId(), "releases", { page: String(cursor) });
  const message = (err: unknown) =>
    err instanceof Error ? err.message : "Не удалось прочитать релизы";
  async function load() {
    const current = ++generation;
    loading.value = true;
    loadingMore.value = false;
    error.value = "";
    try {
      const data = await page(1);
      if (current !== generation) return;
      items.value = data.releases;
      next.value = data.next;
      latestTag.value = data.latestTag;
    } catch (err) {
      if (current === generation) error.value = message(err);
    } finally {
      if (current === generation) loading.value = false;
    }
  }
  async function more() {
    if (next.value === null || loading.value || loadingMore.value) return;
    const current = generation;
    loadingMore.value = true;
    try {
      const data = await page(next.value);
      if (current !== generation) return;
      const known = new Set(items.value.map((item) => item.id));
      items.value = [...items.value, ...data.releases.filter((item) => !known.has(item.id))];
      next.value = data.next;
      if (data.latestTag) latestTag.value = data.latestTag;
    } catch (err) {
      if (current === generation) error.value = message(err);
    } finally {
      if (current === generation) loadingMore.value = false;
    }
  }
  function reset() {
    ++generation;
    items.value = [];
    next.value = null;
    latestTag.value = "";
    loading.value = false;
    loadingMore.value = false;
    error.value = "";
  }
  return { items, next, latestTag, loading, loadingMore, error, load, more, reset };
}
