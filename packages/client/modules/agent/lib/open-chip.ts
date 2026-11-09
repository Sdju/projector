import type { FileRange, MessageChip } from "../../agent-core/index.ts";

export interface ChipActions {
  openFile(path: string, directory: boolean, range?: FileRange): Promise<unknown>;
  openImage(src: string, alt: string): void;
  fail(message: string): void;
}

/** An image chip opens the picture in the chat viewer; a file chip opens its file in the editor. */
export function openChatChip(chip: MessageChip, actions: ChipActions) {
  if (chip.type === "image") {
    actions.openImage(`/api/agent/attachments/${encodeURIComponent(chip.id)}`, chip.name);
    return;
  }
  if (chip.type !== "file") return;
  void actions
    .openFile(chip.path, chip.directory === true, chip.range)
    .catch((cause) =>
      actions.fail(cause instanceof Error ? cause.message : "Не удалось открыть файл"),
    );
}
