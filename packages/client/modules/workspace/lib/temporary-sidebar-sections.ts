import { ref } from "vue";
import {
  fileScopeKey,
  fileScopeNote,
  fileScopeTitle,
  type FileScope,
} from "@ai-projector/core/modules/workspace/index.ts";
import type { SidebarType, WorkspaceCapabilities } from "../../workspace-api/index.ts";

export function useTemporarySidebarSections(
  capabilities: WorkspaceCapabilities,
  showSection: (id: string) => void,
  onClose: (id: string, removed: SidebarType) => void,
) {
  const extraSections = ref<SidebarType[]>([]);
  function openTree(scope: FileScope) {
    if (!capabilities.snapshots) throw new Error("Источник не умеет показывать файлы снимка");
    const id = `tree:${fileScopeKey(scope)}`;
    if (!extraSections.value.some((type) => type.id === id))
      extraSections.value.push({
        id,
        title: fileScopeTitle(scope),
        source: fileScopeNote(scope),
        group: capabilities.git ? "git" : undefined,
        kind: scope.kind === "compare" ? "changes" : "tree",
        params: { scope },
        closable: true,
      });
    showSection(id);
  }
  function openCommitTree(hash: string) {
    openTree({ kind: "commit", rev: hash });
  }
  function openSearch(scope: FileScope) {
    if (scope.kind !== "commit") throw new Error("Поиск доступен только для коммита");
    if (!capabilities.search) throw new Error("Источник не умеет искать по снимку");
    const id = `search:${fileScopeKey(scope)}`;
    if (!extraSections.value.some((type) => type.id === id))
      extraSections.value.push({
        id,
        title: "Поиск по снимку",
        source: fileScopeNote(scope),
        group: capabilities.git ? "git" : undefined,
        kind: "search-scope",
        params: { scope },
        closable: true,
      });
    showSection(id);
  }
  /** Rebuilds temporary sections from a session; view kinds and scopes are derived, not trusted. */
  function restoreSections(saved: SidebarType[]) {
    extraSections.value = saved.flatMap((type) => {
      const raw = type.params?.scope;
      if (!raw || typeof raw !== "object") return [];
      const value = raw as { kind?: unknown; rev?: unknown; from?: unknown; to?: unknown };
      const scope: FileScope | undefined =
        value.kind === "commit" && typeof value.rev === "string"
          ? { kind: "commit", rev: value.rev }
          : value.kind === "compare" &&
              typeof value.from === "string" &&
              typeof value.to === "string"
            ? { kind: "compare", from: value.from, to: value.to }
            : undefined;
      if (!scope) return [];
      if (scope.kind === "compare" ? !capabilities.compare : !capabilities.snapshots) return [];
      const search = type.kind === "search-scope";
      if (search && (scope.kind !== "commit" || !capabilities.search)) return [];
      return [
        {
          id: search ? `search:${fileScopeKey(scope)}` : `tree:${fileScopeKey(scope)}`,
          title: search ? "Поиск по снимку" : fileScopeTitle(scope),
          source: fileScopeNote(scope),
          group: capabilities.git ? "git" : undefined,
          kind: search ? "search-scope" : scope.kind === "compare" ? "changes" : "tree",
          params: { scope },
          closable: true,
        } satisfies SidebarType,
      ];
    });
  }
  function closeSection(id: string) {
    const index = extraSections.value.findIndex((type) => type.id === id);
    if (index < 0) return;
    const [removed] = extraSections.value.splice(index, 1);
    onClose(id, removed!);
  }
  /** Adds or updates a temporary sidebar section and reveals it; tab views own its contents. */
  function openSection(type: SidebarType) {
    const index = extraSections.value.findIndex((item) => item.id === type.id);
    if (index >= 0) extraSections.value.splice(index, 1, type);
    else extraSections.value.push(type);
    showSection(type.id);
  }

  return {
    extraSections,
    openTree,
    openCommitTree,
    openSearch,
    restoreSections,
    closeSection,
    openSection,
  };
}
