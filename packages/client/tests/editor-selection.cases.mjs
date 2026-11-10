import { expect, onTestFinished, test, vi } from "vite-plus/test";
import {
  attachChipsToChat,
  attachRangeToChat,
  attachTextToChat,
} from "../modules/agent/model/attach.ts";
import { registerChat } from "../modules/agent-core/model/chat-registry.ts";
import { createEditorSelection } from "../modules/workspace/lib/editor-selection.ts";

const rangeChip = { type: "file", path: "src/app.ts", range: { from: 12, to: 34 } };

function chat(projectId, key, attach, appendText = async () => {}) {
  return {
    key,
    projectId,
    visible: () => true,
    attach,
    appendText,
  };
}

test("the workspace remembers the last focused editor range and forgets it with the file", () => {
  const selection = createEditorSelection();
  selection.report({ path: "src/app.ts", from: 4, to: 9 });
  expect(selection.current.value).toEqual({ path: "src/app.ts", from: 4, to: 9 });

  selection.clear("src/other.ts");
  expect(selection.current.value).toEqual({ path: "src/app.ts", from: 4, to: 9 });

  selection.clear("src/app.ts");
  expect(selection.current.value).toBeUndefined();
});

test("the selection button acts only while an editor has a range", () => {
  let added = 0;
  const selection = createEditorSelection(() => added++);
  selection.add();
  expect(added).toBe(0);
  selection.report({ path: "src/app.ts", from: 4, to: 9 });
  selection.add();
  expect(added).toBe(1);
});

test("a range chip goes into the open chat without sending it", async () => {
  const added = [];
  const dispose = registerChat(
    chat("selection-open", "selection-open-chat", async (chips) => added.push(chips)),
  );
  onTestFinished(dispose);
  const result = await attachChipsToChat("selection-open", [rangeChip], {
    run: async () => {},
  });
  expect(result.key).toBe("selection-open-chat");
  expect(added).toEqual([[rangeChip]]);
});

test("the editor action builds a file chip with the selected lines", async () => {
  const added = [];
  const dispose = registerChat(
    chat("selection-range", "selection-range-chat", async (chips) => added.push(chips)),
  );
  onTestFinished(dispose);
  await attachRangeToChat(
    "selection-range",
    "src/app.ts",
    { from: 12, to: 34 },
    undefined,
    async () => {},
  );
  expect(added).toEqual([[{ type: "file", path: "src/app.ts", range: { from: 12, to: 34 } }]]);
});

test("a selected text goes into the open chat without sending it", async () => {
  const added = [];
  const dispose = registerChat(
    chat(
      "selection-text",
      "selection-text-chat",
      async () => {},
      async (text) => added.push(text),
    ),
  );
  onTestFinished(dispose);
  const result = await attachTextToChat("selection-text", "  error: failed  ", {
    source: "Выделение из терминала «zsh»",
    run: async () => {},
  });
  expect(result.key).toBe("selection-text-chat");
  expect(added).toEqual(["Выделение из терминала «zsh»:\nerror: failed"]);
});

test("an empty text selection is refused before opening a chat", async () => {
  await expect(attachTextToChat("selection-empty", "   ", { run: async () => {} })).rejects.toThrow(
    "Выделите текст",
  );
});

test("without an open chat a new chat opens and takes the chip", async () => {
  vi.stubGlobal("fetch", async () => Response.json({ chats: [] }));
  onTestFinished(() => vi.unstubAllGlobals());
  const added = [];
  await attachChipsToChat("selection-new", [rangeChip], {
    run: async (id) => {
      expect(id).toBe("ide.workbench.agent.open");
      onTestFinished(
        registerChat(
          chat("selection-new", "selection-new-chat", async (chips) => added.push(chips)),
        ),
      );
    },
  });
  expect(added).toEqual([[rangeChip]]);
});

test("a named chat must be open, otherwise the command says so", async () => {
  await expect(
    attachChipsToChat("selection-missing", [rangeChip], {
      chat: "missing",
      run: async () => {},
    }),
  ).rejects.toThrow("не открыт");
});
