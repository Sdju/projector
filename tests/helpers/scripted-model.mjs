import { createServer } from "node:http";

/**
 * An OpenAI-compatible server that answers from a script instead of a model: each request takes
 * the next step, `{ tool, args }` calls a tool and `{ text }` answers. Lets a test drive the agent
 * loop without a model.
 */
export async function scriptedModel(steps) {
  let index = 0;
  const server = createServer((req, res) => {
    let body = "";
    req.on("data", (chunk) => (body += chunk));
    req.on("end", () => {
      if (!req.url?.endsWith("/chat/completions")) {
        res.writeHead(404).end();
        return;
      }
      const step = steps[Math.min(index++, steps.length - 1)];
      const chunk = (delta, finish = null) =>
        `data: ${JSON.stringify({
          id: "eval",
          object: "chat.completion.chunk",
          choices: [{ index: 0, delta, finish_reason: finish }],
        })}\n\n`;
      res.writeHead(200, { "Content-Type": "text/event-stream" });
      if ("text" in step) {
        res.write(chunk({ role: "assistant", content: step.text }));
        res.write(chunk({}, "stop"));
      } else {
        res.write(
          chunk({
            role: "assistant",
            tool_calls: [
              {
                index: 0,
                id: `call_${index}`,
                type: "function",
                function: { name: step.tool, arguments: JSON.stringify(step.args ?? {}) },
              },
            ],
          }),
        );
        res.write(chunk({}, "tool_calls"));
      }
      res.end("data: [DONE]\n\n");
    });
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  return {
    url: `http://127.0.0.1:${server.address().port}`,
    close: () => new Promise((resolve) => server.close(resolve)),
  };
}
