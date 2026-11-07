import { expect, onTestFinished, test, vi } from "vite-plus/test";
import {
  attachChipsToChat,
  attachRangeToChat,
} from "../packages/client/modules/agent/model/attach.ts";
import { registerChat } from "../packages/client/modules/agent/model/chat-registry.ts";
import { createEditorSelection } from "../packages/client/modules/workspace/lib/editor-selection.ts";

const rangeChip = { type: "file", path: "src/app.ts", range: { from: 12, to: 34 } };

function chat(projectId, key, attach) {
  return {
    key,
    projectId,
    visible: () => true,
    attach,
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
