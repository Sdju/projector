import { expect, test } from "vite-plus/test";
import { openChatChip } from "../packages/client/modules/agent/lib/open-chip.ts";
import { chipText } from "../packages/client/modules/agent-core/lib/message-parts.ts";
import { useChipActions } from "../packages/client/modules/agent/model/use-chip-actions.ts";

const imageChip = { type: "image", id: "pic 1", name: "Снимок.png", mime: "image/png" };

function actions() {
  const opened = { files: [], images: [], errors: [] };
  return {
    opened,
    actions: {
      openFile: (path, directory, range) => {
        opened.files.push({ path, directory, ...(range ? { range } : {}) });
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

test("a range chip opens its file at the same lines", async () => {
  const { opened, actions: chipActions } = actions();
  openChatChip({ type: "file", path: "src/app.ts", range: { from: 12, to: 34 } }, chipActions);
  await Promise.resolve();
  expect(opened.files).toEqual([
    { path: "src/app.ts", directory: false, range: { from: 12, to: 34 } },
  ]);
});

test("the plain text of a range chip names the file and its lines", () => {
  expect(chipText({ type: "file", path: "src/app.ts", range: { from: 12, to: 34 } })).toBe(
    "@src/app.ts:12-34",
  );
  expect(chipText({ type: "file", path: "docs/Мой файл.md", range: { from: 3, to: 3 } })).toBe(
    '@"docs/Мой файл.md":3-3',
  );
});

test("an attached file outside the project opens read-only from disk", async () => {
  const opened = [];
  const { open } = useChipActions(
    "p",
    {
      executeCommand: (_command, args) => {
        opened.push(args);
        return Promise.resolve();
      },
    },
    () => {},
  );
  open({ type: "file", path: "C:\\data\\projector\\attachments\\abcdef\\заметка.txt" });
  await Promise.resolve();
  expect(opened).toEqual([
    {
      path: "C:\\data\\projector\\attachments\\abcdef\\заметка.txt",
      directory: false,
      external: true,
    },
  ]);
});

test("the plain text of an attached file quotes its absolute path when it has spaces", () => {
  expect(chipText({ type: "file", path: "C:\\Мои файлы\\заметка.txt" })).toBe(
    '@"C:\\Мои файлы\\заметка.txt"',
  );
});
