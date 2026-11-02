import { expect, test } from "vite-plus/test";
import { openChatChip } from "../src/modules/agent/lib/open-chip.ts";
import { useChipActions } from "../src/modules/agent/model/use-chip-actions.ts";

const imageChip = { type: "image", id: "pic 1", name: "Снимок.png", mime: "image/png" };

function actions() {
  const opened = { files: [], images: [], errors: [] };
  return {
    opened,
    actions: {
      openFile: (path, directory) => {
        opened.files.push({ path, directory });
        return Promise.resolve();
      },
      openImage: (src, alt) => opened.images.push({ src, alt }),
      fail: (message) => opened.errors.push(message),
    },
  };
}

test("an image chip opens the picture in the chat viewer instead of a new tab", () => {
  const { opened, actions: chipActions } = actions();
  openChatChip(imageChip, chipActions);
  expect(opened.images).toEqual([{ src: "/api/agent/attachments/pic%201", alt: "Снимок.png" }]);
  expect(opened.files).toEqual([]);
});

test("a chat image chip is shown by the same viewer the chat uses", () => {
  const { open, image } = useChipActions(
    "p",
    { executeCommand: () => Promise.resolve() },
    () => {},
  );
  open(imageChip);
  expect(image.value).toEqual({ src: "/api/agent/attachments/pic%201", alt: "Снимок.png" });
});

test("a file chip still opens its file in the editor", async () => {
  const { opened, actions: chipActions } = actions();
  openChatChip({ type: "file", path: "src/app.ts" }, chipActions);
  await Promise.resolve();
  expect(opened.files).toEqual([{ path: "src/app.ts", directory: false }]);
  expect(opened.images).toEqual([]);
});
