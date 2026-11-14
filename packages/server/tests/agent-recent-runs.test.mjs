import "../../../tests/helpers/builtins.mjs";
import { once } from "node:events";
import { createServer } from "node:http";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, expect, test } from "vite-plus/test";

const root = await mkdtemp(join(tmpdir(), "projector-recent-runs-"));
const work = join(root, "work");
process.env.XDG_DATA_HOME = join(root, "data");
await mkdir(join(root, "data", "projector"), { recursive: true });
await mkdir(work, { recursive: true });
await writeFile(
  join(root, "data", "projector", "projects.json"),
  JSON.stringify({ projects: [{ id: "p1", name: "work", path: work, commands: [] }] }),
);

const { registerAgentBackend } = await import("../modules/agent/index.ts");
const { hasAnswerForm } = await import("../modules/agent/recent-runs.ts");

registerAgentBackend({
  id: "fake-chat-run",
  label: "Fake Chat Run",
  capabilities: { hosted: true },
  async run(options) {
    if (options.message === "form") {
      options.emit("done", {
        text: 'Выберите вариант:\n\n<IntelligentForm summary="Выбор"><Field type="radio" name="x" :options="[\'a\',\'b\']" /></IntelligentForm>',
      });
      return;
    }
    if (options.message === "fail") {
      options.emit("error", { error: "boom" });
      return;
    }
    options.emit("session", { id: "s-chat-1", backend: "fake-chat-run" });
    options.emit("text", { text: "Готово, всё обновлено." });
    options.emit("done", { text: "Готово, всё обновлено." });
  },
});

const { handleApi } = await import("../app/api.ts");
const server = createServer((req, res) => void handleApi(req, res));
server.listen(0, "127.0.0.1");
await once(server, "listening");
const base = `http://127.0.0.1:${server.address().port}`;

afterAll(async () => {
  server.closeAllConnections();
  server.close();
  await rm(root, { recursive: true, force: true });
});

test("hasAnswerForm detects trailing forms and ignores forms followed by prose", () => {
  expect(
    hasAnswerForm(
      'Уточните:\n\n<IntelligentForm summary="X"><Field type="text" name="a" /></IntelligentForm>',
    ),
  ).toBe(true);
  expect(
    hasAnswerForm(
      '<Card title="Форма"><Form><Field type="text" name="a" /></Form></Card>\n<script>const x = 1; return { x };</script>',
    ),
  ).toBe(true);
  expect(hasAnswerForm('<Form><Field type="text" name="a" /></Form>\n\nТекст после формы')).toBe(
    false,
  );
  expect(hasAnswerForm("Обычный ответ без формы.")).toBe(false);
});

test("completed chat runs appear in /api/agent/runs recent list with awaitingReply and error status", async () => {
  const post = (body) =>
    fetch(`${base}/api/agent`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Origin: base },
      body: JSON.stringify(body),
    });

  const doneRes = await post({
    projectId: "p1",
    chat: "fake-chat-run:p1:c1",
    backend: "fake-chat-run",
    message: "hello",
  });
  await doneRes.text();

  const formRes = await post({
    projectId: "p1",
    chat: "fake-chat-run:p1:c2",
    backend: "fake-chat-run",
    message: "form",
  });
  await formRes.text();

  const failRes = await post({
    projectId: "p1",
    chat: "fake-chat-run:p1:c3",
    backend: "fake-chat-run",
    message: "fail",
  });
  await failRes.text();

  const feed = await (await fetch(`${base}/api/agent/runs`)).json();
  expect(feed.runs).toEqual([]);
  const byChat = new Map(feed.recent.map((item) => [item.chat, item]));
  expect(byChat.get("fake-chat-run:p1:c1")).toMatchObject({
    status: "done",
    resultPreview: "Готово, всё обновлено.",
    session: "s-chat-1",
  });
  expect(byChat.get("fake-chat-run:p1:c2")).toMatchObject({
    status: "done",
    awaitingReply: true,
  });
  expect(byChat.get("fake-chat-run:p1:c3")).toMatchObject({
    status: "error",
    error: "boom",
  });
});
