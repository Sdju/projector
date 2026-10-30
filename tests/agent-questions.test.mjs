import { expect, test } from "vite-plus/test";
import {
  completeCommandRequest,
  createQuestionBridge,
} from "../server/modules/agent/command-bridge.ts";
import { askClaudeQuestions } from "../server/modules/agents/claude-code/questions.ts";
import { askCursorQuestions } from "../server/modules/agents/cursor/questions.ts";
import { codexProgram } from "../server/modules/agents/codex/index.ts";

const claudeInput = {
  questions: [
    {
      question: "Which library?",
      header: "Library",
      multiSelect: false,
      options: [{ label: "date-fns", description: "small" }, { label: "dayjs" }],
    },
    {
      question: "Which features?",
      header: "Features",
      multiSelect: true,
      options: [{ label: "A" }, { label: "B" }, { label: "C" }],
    },
  ],
};

test("Claude Code gets the user's choices back in the AskUserQuestion input", async () => {
  let asked;
  const result = await askClaudeQuestions(
    {
      ask: async (request) => {
        asked = request;
        return { 0: ["1"], 1: ["0", "2", "my own"] };
      },
    },
    claudeInput,
  );
  expect(asked.custom).toBe(true);
  expect(asked.questions[0]).toMatchObject({ id: "0", multiple: false, header: "Library" });
  expect(asked.questions[0].options[0]).toMatchObject({ id: "0", description: "small" });
  expect(result).toMatchObject({
    behavior: "allow",
    updatedInput: {
      answers: { "Which library?": "dayjs", "Which features?": "A, C, my own" },
    },
  });
  expect(result.updatedInput.questions).toEqual(claudeInput.questions);
});

test("a skipped or impossible question is denied, never answered with nothing", async () => {
  expect(await askClaudeQuestions({ ask: async () => null }, claudeInput)).toMatchObject({
    behavior: "deny",
  });
  expect(await askClaudeQuestions({}, claudeInput)).toMatchObject({ behavior: "deny" });
  expect(await askClaudeQuestions({ ask: async () => ({}) }, { questions: [] })).toMatchObject({
    behavior: "deny",
  });
  expect(
    await askClaudeQuestions({ ask: async () => Promise.reject(new Error("x")) }, claudeInput),
  ).toMatchObject({ behavior: "deny" });
});

test("Cursor's ask_question answers with the chosen option IDs", async () => {
  const params = {
    toolCallId: "t",
    title: "Setup",
    questions: [
      {
        id: "q1",
        prompt: "Pick",
        options: [
          { id: "a", label: "A" },
          { id: "b", label: "B" },
        ],
        allowMultiple: true,
      },
    ],
  };
  let asked;
  const answered = await askCursorQuestions(
    {
      ask: async (request) => {
        asked = request;
        return { q1: ["b", "not-an-option"] };
      },
    },
    params,
  );
  expect(asked).toMatchObject({ title: "Setup", custom: false });
  expect(answered).toEqual({
    outcome: {
      outcome: "answered",
      answers: [{ questionId: "q1", selectedOptionIds: ["b"] }],
    },
  });
  expect(await askCursorQuestions({ ask: async () => null }, params)).toMatchObject({
    outcome: { outcome: "skipped" },
  });
  expect(await askCursorQuestions({}, params)).toEqual({ outcome: { outcome: "cancelled" } });
});

test("the question bridge delivers the answers of the page and null for a skip", async () => {
  const events = [];
  const ask = createQuestionBridge(
    (event, data) => events.push([event, data]),
    new AbortController().signal,
  );
  const request = {
    questions: [{ id: "0", question: "?", options: [], multiple: false }],
    custom: true,
  };
  const first = ask(request);
  expect(events[0][0]).toBe("question-request");
  completeCommandRequest(events[0][1].id, { output: { answers: { 0: ["x", 5] } } });
  expect(await first).toEqual({ 0: ["x"] });
  const second = ask(request);
  completeCommandRequest(events[1][1].id, { output: {} });
  expect(await second).toBeNull();
});

test("an OpenCode question form is shown as questions and answered with choices and own words", async () => {
  const { elicitForm } = await import("../server/modules/agents/acp/acp-elicitation.ts");
  const params = {
    mode: "form",
    message: "Questions",
    requestedSchema: {
      type: "object",
      properties: {
        q0: {
          type: "string",
          title: "Which color?",
          oneOf: [
            { const: "Red", title: "Red" },
            { const: "Green", title: "Green", description: "calm" },
          ],
        },
        q0_custom: { type: "string", title: "Which color? (other)" },
        q1: {
          type: "array",
          title: "Which sizes?",
          items: {
            anyOf: [
              { const: "S", title: "S" },
              { const: "M", title: "M" },
            ],
          },
        },
        q1_custom: { type: "string" },
      },
      required: [],
    },
  };
  let asked;
  const chosen = await elicitForm(
    {
      ask: async (request) => {
        asked = request;
        return { q0: ["Green"], q1: ["S", "M"] };
      },
    },
    params,
  );
  expect(asked.title).toBe("Questions");
  expect(asked.questions.map((item) => [item.id, item.multiple, item.custom])).toEqual([
    ["q0", false, true],
    ["q1", true, true],
  ]);
  expect(asked.questions[0].options[1]).toMatchObject({ id: "Green", description: "calm" });
  expect(chosen).toEqual({ action: "accept", content: { q0: "Green", q1: ["S", "M"] } });
  const own = await elicitForm({ ask: async () => ({ q0: ["teal"], q1: [] }) }, params);
  expect(own).toEqual({ action: "accept", content: { q0_custom: "teal" } });
  expect(await elicitForm({ ask: async () => null }, params)).toEqual({ action: "decline" });
  expect(await elicitForm({}, params)).toEqual({ action: "cancel" });
});

test("a Codex user-input form keeps its note field and 'none of the above' fallback", async () => {
  const { elicitForm } = await import("../server/modules/agents/acp/acp-elicitation.ts");
  const params = {
    mode: "form",
    message: "Codex needs your input to continue.",
    requestedSchema: {
      type: "object",
      properties: {
        pick: {
          type: "string",
          title: "Pick",
          oneOf: [
            { const: "A", title: "A" },
            { const: "None of the above", title: "None of the above" },
          ],
        },
        pick_note: {
          type: "string",
          title: "Additional answer or note",
          _meta: { codex: { questionId: "pick", role: "user_note" } },
        },
        name: { type: "string", title: "Name" },
      },
      required: ["pick", "name"],
    },
  };
  let asked;
  const result = await elicitForm(
    {
      ask: async (request) => {
        asked = request;
        return { pick: ["something else"], name: ["Ann"] };
      },
    },
    params,
    codexProgram.forms,
  );
  expect(
    asked.questions.map((item) => [item.id, item.options.length, item.custom, item.optional]),
  ).toEqual([
    ["pick", 1, true, false],
    ["name", 0, true, false],
  ]);
  expect(result).toEqual({
    action: "accept",
    content: { pick: "None of the above", pick_note: "something else", name: "Ann" },
  });
});

test("a question an ACP agent asks reaches the user through runAgent and the answer goes back", async () => {
  const { mkdtemp, rm } = await import("node:fs/promises");
  const { tmpdir } = await import("node:os");
  const { join } = await import("node:path");
  const { fileURLToPath } = await import("node:url");
  const { acpProgram, registerAcpProgram } =
    await import("../server/modules/agents/acp/acp-programs.ts");
  const { runAgent } = await import("../server/modules/agent/index.ts");
  const fake = fileURLToPath(new URL("./fixtures/fake-acp-asker.mjs", import.meta.url));
  const cwd = await mkdtemp(join(tmpdir(), "projector-ask-"));
  const saved = { cursor: acpProgram("cursor"), opencode: acpProgram("opencode") };
  const run = async (backend, kind, answers) => {
    process.env.FAKE_ACP_ASK = kind;
    // The fake agent keeps the real program's extensions and dialect; only the command changes.
    registerAcpProgram({ ...saved[backend], command: process.execPath, args: [fake] });
    const asked = [];
    const events = [];
    await runAgent({
      backend,
      cwd,
      message: "hi",
      ask: async (request) => {
        asked.push(request);
        return answers;
      },
      emit: (event, data) => events.push([event, data]),
    });
    const text = events
      .filter(([event]) => event === "text")
      .map(([, data]) => data.text)
      .join("");
    return { asked, text, events };
  };
  try {
    const cursor = await run("cursor", "cursor", { c: ["g"] });
    expect(cursor.asked[0].questions[0]).toMatchObject({ id: "c", question: "Which color?" });
    expect(JSON.parse(cursor.text)).toEqual({
      outcome: { outcome: "answered", answers: [{ questionId: "c", selectedOptionIds: ["g"] }] },
    });
    const skipped = await run("cursor", "cursor", null);
    expect(JSON.parse(skipped.text).outcome.outcome).toBe("skipped");

    const form = await run("opencode", "form", { q0: ["teal"] });
    expect(form.asked[0]).toMatchObject({ title: "Questions" });
    expect(JSON.parse(form.text)).toEqual({ action: "accept", content: { q0_custom: "teal" } });
  } finally {
    delete process.env.FAKE_ACP_ASK;
    for (const program of Object.values(saved)) registerAcpProgram(program);
    await rm(cwd, { recursive: true, force: true });
  }
});
