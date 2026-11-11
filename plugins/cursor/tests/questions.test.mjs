import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { expect, test } from "vite-plus/test";
import { askCursorQuestions } from "../src/questions.ts";
import { createAgents } from "../src/index.ts";
import {
  acpProgram,
  registerAcpProgram,
} from "../../../packages/server/modules/agents/acp/acp-programs.ts";
import {
  createAcpBackend,
  extendPlainDialect,
  inputOf,
  isOver,
  shorten,
} from "../../../packages/server/modules/agents/acp/index.ts";
import { registerAgentBackend, runAgent } from "../../../packages/server/modules/agent/index.ts";

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

test("Cursor's ask_question answers with the chosen option IDs", async () => {
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

test("a question Cursor asks reaches the user through runAgent and the answer goes back", async () => {
  const fake = fileURLToPath(
    new URL("../../../tests/fixtures/fake-acp-asker.mjs", import.meta.url),
  );
  const cwd = await mkdtemp(join(tmpdir(), "projector-ask-"));
  registerAgentBackend(
    createAgents({
      version: 1,
      createAcpBackend,
      acp: { extendPlainDialect, inputOf, isOver, shorten },
    })[0],
  );
  const saved = acpProgram("cursor");
  const run = async (answers) => {
    process.env.FAKE_ACP_ASK = "cursor";
    registerAcpProgram({ ...saved, command: process.execPath, args: [fake] });
    const asked = [];
    const events = [];
    await runAgent({
      backend: "cursor",
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
    return { asked, text };
  };
  try {
    const cursor = await run({ c: ["g"] });
    expect(cursor.asked[0].questions[0]).toMatchObject({ id: "c", question: "Which color?" });
    expect(JSON.parse(cursor.text)).toEqual({
      outcome: { outcome: "answered", answers: [{ questionId: "c", selectedOptionIds: ["g"] }] },
    });
    const skipped = await run(null);
    expect(JSON.parse(skipped.text).outcome.outcome).toBe("skipped");
  } finally {
    delete process.env.FAKE_ACP_ASK;
    registerAcpProgram(saved);
    await rm(cwd, { recursive: true, force: true });
  }
});
