import type { MessageChip } from "../model/types.ts";

export interface ChipActions {
  openFile(path: string, directory: boolean): Promise<unknown>;
  fail(message: string): void;
}

/** An image chip opens the picture in a tab; a file chip opens its file in the editor. */
export function openChatChip(chip: MessageChip, actions: ChipActions) {
  if (chip.type === "image") {
    window.open(`/api/agent/attachments/${encodeURIComponent(chip.id)}`, "_blank", "noopener");
    return;
  }
  if (chip.type !== "file") return;
  void actions
    .openFile(chip.path, chip.directory === true)
    .catch((cause) =>
      actions.fail(cause instanceof Error ? cause.message : "Не удалось открыть файл"),
    );
}
