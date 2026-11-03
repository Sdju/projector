import { ref } from "vue";
import { openChatChip } from "../lib/open-chip.ts";
import type { MessageChip } from "./types.ts";

interface ChatApi {
  executeCommand(
    command: string,
    args: { path: string; directory: boolean },
    options: { scope: string },
  ): Promise<unknown>;
}

/** What a click on a chat chip does: a file opens in the editor, a picture in the shared viewer. */
export function useChipActions(projectId: string, api: ChatApi, fail: (message: string) => void) {
  const image = ref<{ src: string; alt: string }>();
  const open = (chip: MessageChip) =>
    openChatChip(chip, {
      openFile: (path, directory) =>
        api.executeCommand(
          "ide.editor.path.open",
          { path, directory },
          { scope: `editor:${projectId}` },
        ),
      openImage: (src, alt) => (image.value = { src, alt }),
      fail,
    });
  return { open, image };
}
