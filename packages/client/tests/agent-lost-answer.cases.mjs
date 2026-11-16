import { expect, test } from "vite-plus/test";
import {
  answerLost,
  recoverTurn,
  restoreLostAnswer,
} from "../modules/agent-core/model/lost-answer.ts";
import { INTERRUPTED } from "../modules/agent-core/model/load-history.ts";
import { sessionIdOf } from "../modules/agent-core/model/session-tail.ts";

const user = (text) => ({ id: `u${text}`, role: "user", text, tools: [] });
const answer = (text, extra = {}) => ({
  id: `a${text}`,
  role: "assistant",
  text,
  tools: [],
  session: { backend: "opencode", id: "s1" },
  ...extra,
});

test("an answer the page never received comes back from the agent's session", () => {
  const turns = [user("почини баг"), answer(INTERRUPTED, { failure: "overloaded" })];
  const native = [
    user("[Projector] подсказки\n\nпочини баг"),
    answer("Готово: починил.", {
      tools: [{ id: "t1", name: "edit", status: "done", detail: "ok" }],
      parts: [
        { type: "text", text: "Готово: починил." },
        { type: "tool", id: "t1" },
      ],
    }),
  ];
  expect(answerLost(turns[1])).toBe(true);
  expect(restoreLostAnswer(turns, native)).toBe(true);
  expect(turns[1].text).toBe("Готово: починил.");
  expect(turns[1].tools.map((tool) => tool.id)).toEqual(["t1"]);
  expect(turns[1].parts?.map((part) => part.type)).toEqual(["text", "tool"]);
  expect(turns[1].failure).toBeUndefined();
  expect(turns[1].session).toEqual({ backend: "opencode", id: "s1" });
});

test("a finished answer is never replaced by the transcript", () => {
  const turns = [user("вопрос"), answer("свой ответ")];
  expect(answerLost(turns[1])).toBe(false);
  expect(restoreLostAnswer(turns, [user("вопрос"), answer("другой ответ")])).toBe(false);
  expect(turns[1].text).toBe("свой ответ");
});

test("tool cards saved before the text do not hide a lost answer", () => {
  const turns = [
    user("вопрос"),
    answer("", { tools: [{ id: "t", name: "bash", status: "done", detail: "ok" }] }),
  ];
  const native = [
    user("вопрос"),
    answer("Готово: снизил лимит.", {
      tools: [
        { id: "t", name: "bash", status: "done", detail: "ok" },
        { id: "t2", name: "edit", status: "done", detail: "ok" },
      ],
    }),
  ];
  expect(answerLost(turns[1])).toBe(true);
  expect(restoreLostAnswer(turns, native)).toBe(true);
  expect(turns[1].text).toBe("Готово: снизил лимит.");
  expect(turns[1].tools.map((tool) => tool.id)).toEqual(["t", "t2"]);
});

test("a stopped or a live answer is not replaced by the transcript", () => {
  const tools = [{ id: "t", name: "bash", status: "done", detail: "ok" }];
  expect(answerLost(answer("", { tools, stopped: "steps" }))).toBe(false);
  expect(answerLost(answer("", { tools, run: "run-live" }))).toBe(false);
});

test("a transcript is read once per turn, even when it has no text to add", async () => {
  const turns = [
    user("вопрос"),
    answer("", { tools: [{ id: "t", name: "bash", status: "done" }] }),
  ];
  let loads = 0;
  const load = async () => {
    loads += 1;
    return [user("вопрос")];
  };
  expect(await recoverTurn(turns, turns[1], load, () => {})).toBe(false);
  expect(await recoverTurn(turns, turns[1], load, () => {})).toBe(false);
  expect(loads).toBe(1);
});

test("a busy session is asked again when it becomes readable", async () => {
  const turns = [
    user("вопрос"),
    answer("", { tools: [{ id: "t", name: "bash", status: "done" }] }),
  ];
  let loads = 0;
  const busy = async () => {
    loads += 1;
    throw new Error("session is in use");
  };
  expect(await recoverTurn(turns, turns[1], busy, () => {})).toBe(false);
  expect(await recoverTurn(turns, turns[1], busy, () => {})).toBe(false);
  expect(loads).toBe(2);
});

test("a session continued elsewhere does not lend a later answer to a lost question", () => {
  const turns = [user("первый"), answer(INTERRUPTED)];
  const native = [user("первый"), user("второй"), answer("ответ на второй")];
  expect(restoreLostAnswer(turns, native)).toBe(false);
  expect(turns[1].text).toBe(INTERRUPTED);
});

test("questions are matched by their ending, not the whole transcript line", () => {
  const turns = [user("а что дальше?"), answer("")];
  const native = [user("[Projector] правила чата\n\nа что дальше?"), answer("Дальше — тесты.")];
  expect(restoreLostAnswer(turns, native)).toBe(true);
  expect(turns[1].text).toBe("Дальше — тесты.");
});

test("nothing is restored without the agent's own session", () => {
  const turns = [user("вопрос"), { id: "a", role: "assistant", text: "", tools: [] }];
  expect(restoreLostAnswer(turns, [])).toBe(false);
  expect(turns[1].text).toBe("");
});

test("the chat continues the session of the last finished answer, not a lost one", () => {
  const turns = [
    user("первый"),
    answer("готово", { session: { backend: "opencode", id: "ses_one" } }),
    user("второй"),
    { id: "a2", role: "assistant", text: INTERRUPTED, tools: [] },
  ];
  expect(sessionIdOf(turns)).toBe("ses_one");
  expect(sessionIdOf(turns.slice(0, 2))).toBe("ses_one");
  expect(sessionIdOf(turns.slice(0, 1))).toBeUndefined();
});

test("a detached answer stops the chat from continuing any session", () => {
  const turns = [
    user("первый"),
    answer("готово", { detached: true, session: { backend: "opencode", id: "ses_one" } }),
    user("второй"),
    { id: "a2", role: "assistant", text: INTERRUPTED, tools: [] },
  ];
  expect(sessionIdOf(turns)).toBeUndefined();
});

test("an answer split by harness reminders and many messages comes back whole", () => {
  const turns = [user("исправь систему пермишенов"), answer(INTERRUPTED)];
  const native = [
    user("исправь систему пермишенов\n<system-reminder>план принят</system-reminder>"),
    answer("Сначала посмотрю код.", {
      tools: [{ id: "1:tool_a", name: "Read", status: "done", detail: "ok" }],
    }),
    user("<system-reminder>\nTodo list:\n  [done] Прочитать код\n</system-reminder>"),
    answer("Правлю обработку разрешения.", {
      tools: [{ id: "2:tool_b", name: "Edit", status: "done", detail: "ok" }],
    }),
    // A real follow-up question: everything after it belongs to another answer.
    user("а теперь тесты"),
    answer("Тесты добавил."),
  ];
  expect(restoreLostAnswer(turns, native)).toBe(true);
  expect(turns[1].text).toBe("Сначала посмотрю код.\n\nПравлю обработку разрешения.");
  expect(turns[1].tools.map((tool) => tool.id)).toEqual(["1:tool_a", "2:tool_b"]);
  expect(turns[1].parts?.map((part) => part.type)).toEqual(["text", "tool", "text", "tool"]);
});

test("tool calls without any text still restore the progress of a lost answer", () => {
  const turns = [user("почини"), answer("")];
  const native = [
    user("почини\n<system-reminder>напоминание</system-reminder>"),
    answer("", { tools: [{ id: "1:tool_a", name: "Bash", status: "done", detail: "ok" }] }),
  ];
  expect(restoreLostAnswer(turns, native)).toBe(true);
  expect(turns[1].text).toBe("");
  expect(turns[1].tools.map((tool) => tool.id)).toEqual(["1:tool_a"]);
});

test("a recovered answer is saved, so it is not fetched again", async () => {
  const turns = [user("почини"), answer(INTERRUPTED)];
  let saved = 0;
  const done = await recoverTurn(
    turns,
    turns[1],
    async () => [user("почини"), answer("Починил.")],
    () => saved++,
  );
  expect(done).toBe(true);
  expect(saved).toBe(1);
  expect(turns[1].text).toBe("Починил.");
});

test("a session that cannot be loaded keeps the placeholder", async () => {
  const turns = [user("почини"), answer(INTERRUPTED)];
  let saved = 0;
  const done = await recoverTurn(
    turns,
    turns[1],
    async () => {
      throw new Error("session is in use");
    },
    () => saved++,
  );
  expect(done).toBe(false);
  expect(saved).toBe(0);
  expect(turns[1].text).toBe(INTERRUPTED);
});
