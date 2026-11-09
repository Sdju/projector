import { onMounted, type Ref } from "vue";
import type { EditorView } from "@codemirror/view";
import { isFileDrag, pathsFromDataTransfer } from "../../../../path-drop/index.ts";
import { uploadAttachment } from "../../../../agent-core/index.ts";
import { workspaceRequest } from "../../../../workspace-api/index.ts";
import { chipText } from "../../../../agent-core/index.ts";
import { insertChip } from "../../../../agent-core/index.ts";
import { insertDropped } from "./editing.ts";
import type { MessageChip } from "../../../../agent-core/index.ts";

/** Drop, paste and upload of files, folders and pictures into the composer. */
export function useComposerDrop(options: {
  projectId: () => string | undefined;
  view: Ref<EditorView | undefined>;
  onFail: (message: string) => void;
}) {
  // The project folder, to show dropped absolute paths relative to it.
  let root = "";

  async function loadRoot() {
    const projectId = options.projectId();
    if (!projectId) return;
    try {
      root = (await workspaceRequest<{ root: string }>(projectId, "root")).root;
    } catch {
      root = "";
    }
  }
  onMounted(loadRoot);

  function chipForPath(path: string): MessageChip {
    const inside = root && path.startsWith(`${root}/`);
    return { type: "file", path: inside ? path.slice(root.length + 1) : path };
  }

  function droppedChips(data: DataTransfer): MessageChip[] {
    const projectId = options.projectId();
    const entry = data.getData("application/x-projector-tree-entry");
    if (entry) {
      try {
        const value = JSON.parse(entry) as { projectId?: unknown; path?: unknown; paths?: unknown };
        if (value.projectId !== projectId) return [];
        const paths = Array.isArray(value.paths) && value.paths.length ? value.paths : [value.path];
        return paths
          .filter((path): path is string => typeof path === "string" && !!path)
          .map((path): MessageChip => ({ type: "file", path }));
      } catch {
        return [];
      }
    }
    return pathsFromDataTransfer(data).map(chipForPath);
  }

  /** Uploads pasted or dropped images and puts each in as a chip where the cursor or drop was. */
  async function attachImages(files: File[], at?: number) {
    const target = options.view.value;
    if (!target) return;
    let position = at;
    for (const file of files) {
      try {
        const chip = await uploadAttachment(file);
        const head = Math.min(
          position ?? target.state.selection.main.head,
          target.state.doc.length,
        );
        insertChip(target, head, head, chip);
        position = head + chipText(chip).length + 1;
      } catch (error) {
        options.onFail(error instanceof Error ? error.message : "Не удалось загрузить изображение");
      }
    }
    target.focus();
  }

  const imagesOf = (data: DataTransfer | null) =>
    [...(data?.files ?? [])].filter((file) => file.type.startsWith("image/"));

  function pasteImages(data: DataTransfer | null): boolean {
    const images = imagesOf(data);
    if (!images.length) return false;
    void attachImages(images);
    return true;
  }

  function acceptsDrag(data: DataTransfer | null): data is DataTransfer {
    return (
      !!data && (isFileDrag(data) || data.types.includes("application/x-projector-tree-entry"))
    );
  }

  /** Puts dropped files, folders and images in as chips; false when there was nothing to take. */
  function dropData(data: DataTransfer, at?: number): boolean {
    const target = options.view.value;
    if (!target) return false;
    const position = at ?? target.state.selection.main.head;
    const chips = droppedChips(data);
    if (chips.length) {
      insertDropped(target, chips, position);
      target.focus();
      return true;
    }
    // The browser gave no path (a dragged image, not a file): send the image itself.
    const images = imagesOf(data);
    if (!images.length) return false;
    void attachImages(images, position);
    return true;
  }

  return { acceptsDrag, dropData, pasteImages, attachImages };
}
