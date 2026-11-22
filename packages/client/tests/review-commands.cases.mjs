import { expect, onTestFinished, test } from "vite-plus/test";
import { createCommandService } from "../../core/modules/ide/index.ts";
import { registerChat } from "../modules/agent-core/model/chat-registry.ts";
import { registerReviewCommands } from "../modules/workspace/modules/review/lib/review-commands.ts";
import {
  formatCommentCount,
  formatFileCount,
  formatLineLabel,
  formatLineRange,
  formatReviewMessage,
  reviewChips,
} from "../modules/workspace/modules/review/lib/review-message.ts";
import { createReviewSession } from "../modules/workspace/modules/review/lib/review-session.ts";

function reviewScope(session, projectId = "review-project") {
  const sdk = createCommandService();
  const scope = sdk.createScope("editor", () => ({ surface: "editor", projectId }));
  const opened = [];
  const files = [];
  registerReviewCommands({
    projectId,
    review: session,
    register: (id, title, run, enabled, requires, meta) =>
      scope.registerCommand({
        id,
        title,
        run,
        enabled: (args) =>
          (!requires || requires === "git" || requires === "agent") && enabled(args),
        ...meta,
      }),
    openTab: () => opened.push("review"),
    openFile: (path, from, to, staged) => files.push({ path, from, to, staged }),
    run: async () => {},
  });
  return { scope, opened, files };
}

test("the review message lists each remark with its path and lines", () => {
  expect(formatLineRange(12, 12)).toBe("12");
  expect(formatLineRange(12, 14)).toBe("12–14");
  expect(formatLineLabel(12, 12)).toBe("строка 12");
  expect(formatLineLabel(12, 14)).toBe("строки 12–14");
  expect(formatCommentCount(1)).toBe("1 замечание");
  expect(formatCommentCount(3)).toBe("3 замечания");
  expect(formatCommentCount(5)).toBe("5 замечаний");
  expect(formatFileCount(2)).toBe("2 файла");
  const comments = [
    { id: "a", path: "src/app.ts", from: 12, to: 14, text: "Пустой массив", createdAt: 1 },
    { id: "b", path: "src/bar.ts", from: 8, to: 8, text: "Опечатка", createdAt: 2 },
  ];
  expect(formatReviewMessage(comments)).toBe(
    "Замечания ревью:\n\nsrc/app.ts:12–14\nПустой массив\n\nsrc/bar.ts:8\nОпечатка",
  );
  expect(reviewChips(comments)).toEqual([
    { type: "file", path: "src/app.ts", range: { from: 12, to: 14 } },
    { type: "file", path: "src/bar.ts", range: { from: 8, to: 8 } },
  ]);
});

test("remarks work immediately, separate staged from working side, and support edit/clear", () => {
  const session = createReviewSession();
  const working = session.add({
    path: "src/a.ts",
    from: 2,
    to: 4,
    staged: false,
    snippet: "const a = 1;\nconst b = 2;",
    text: "  проверить  ",
  });
  const staged = session.add({
    path: "src/a.ts",
    from: 10,
    to: 10,
    staged: true,
    text: "индекс",
  });
  expect(working.text).toBe("проверить");
  expect(working.snippet).toBe("const a = 1;\nconst b = 2;");
  expect(session.commentsFor("src/a.ts", false).map((item) => item.id)).toEqual([working.id]);
  expect(session.commentsFor("src/a.ts", undefined).map((item) => item.id)).toEqual([working.id]);
  expect(session.commentsFor("src/a.ts", true).map((item) => item.id)).toEqual([staged.id]);

  const updated = session.update(working.id, "исправлено описание");
  expect(updated.text).toBe("исправлено описание");
  expect(session.clear()).toBe(2);
  expect(session.comments.value).toHaveLength(0);
});

test("review commands add, compose inline, update, open, remove and clear remarks", async () => {
  const session = createReviewSession();
  const { scope, opened, files } = reviewScope(session);

  const composing = await scope.executeCommand("ide.review.comment.add", {
    path: "src/app.ts",
    from: 5,
    staged: false,
  });
  expect(composing).toEqual({
    composing: { path: "src/app.ts", from: 5, to: 5, staged: false },
  });
  expect(files).toEqual([{ path: "src/app.ts", from: 5, to: 5, staged: false }]);
  expect(session.composing.value?.from).toBe(5);

  const added = await scope.executeCommand("ide.review.comment.add", {
    path: "src/app.ts",
    from: 12,
    to: 14,
    text: "граничный случай",
    staged: false,
    snippet: "if (!items.length) return;",
  });
  expect(added.path).toBe("src/app.ts");
  expect(added.from).toBe(12);
  expect(added.snippet).toBe("if (!items.length) return;");

  const updated = await scope.executeCommand("ide.review.comment.update", {
    id: added.id,
    text: "уточнённое замечание",
  });
  expect(updated.text).toBe("уточнённое замечание");

  const openedTab = await scope.executeCommand("ide.review.open");
  expect(opened).toEqual(["review"]);
  expect(openedTab.comments).toBe(1);

  await scope.executeCommand("ide.review.comment.open", { id: added.id });
  expect(files.at(-1)).toEqual({ path: "src/app.ts", from: 12, to: 14, staged: false });

  await scope.executeCommand("ide.review.comment.remove", { id: added.id });
  expect(session.comments.value).toHaveLength(0);

  await scope.executeCommand("ide.review.comment.add", {
    path: "src/app.ts",
    from: 1,
    text: "первое",
  });
  const cleared = await scope.executeCommand("ide.review.clear");
  expect(cleared).toEqual({ removed: 1 });
  expect(session.comments.value).toHaveLength(0);
});

test("sending remarks puts file chips and the message into the open chat and marks sent", async () => {
  const session = createReviewSession();
  session.add({ path: "src/app.ts", from: 12, to: 14, text: "Пустой массив" });
  const chips = [];
  const texts = [];
  const dispose = registerChat({
    key: "review-chat",
    projectId: "review-project",
    visible: () => true,
    attach: async (added) => chips.push(added),
    appendText: async (text) => texts.push(text),
  });
  onTestFinished(dispose);
  const { scope } = reviewScope(session);
  await scope.executeCommand("ide.review.toChat");
  expect(chips).toEqual([[{ type: "file", path: "src/app.ts", range: { from: 12, to: 14 } }]]);
  expect(texts[0]).toContain("src/app.ts:12–14");
  expect(texts[0]).toContain("Пустой массив");
  expect(session.sentAt.value).toBeTypeOf("number");
});
