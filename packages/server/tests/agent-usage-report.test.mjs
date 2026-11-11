import { expect, test } from "vite-plus/test";
import { acpProgram } from "../modules/agents/acp/acp-programs.ts";
import { usageReportOf } from "../modules/agents/acp/index.ts";
import { createPluginAgent } from "../modules/agents/plugin/index.ts";

test("projector/usage keeps tokens, model and a recorded cost", () => {
  expect(
    usageReportOf({
      input: 120,
      output: 30,
      cacheRead: 400,
      cacheWrite: 20,
      model: "example-model",
      cost: 0.004,
      ignored: true,
    }),
  ).toEqual({
    input: 120,
    output: 30,
    cacheRead: 400,
    cacheWrite: 20,
    model: "example-model",
    cost: 0.004,
  });
  expect(usageReportOf({ input: 0, output: 0 })).toBeUndefined();
  expect(usageReportOf({ input: -1, output: "30" })).toBeUndefined();
});

test("a plugin agent forwards the usage notification as the chat's usage event", () => {
  createPluginAgent({
    id: "usage-report-fixture",
    title: "Usage Fixture",
    command: "example-agent",
    args: ["acp"],
  });
  const program = acpProgram("usage-report-fixture");
  const emitted = [];
  program.notifications["projector/usage"](
    {
      message: "",
      emit: (event, data) => emitted.push([event, data]),
      history: [],
    },
    { input: 10, output: 5, cacheRead: 3, cacheWrite: 2, model: "m" },
  );
  expect(emitted).toEqual([
    ["usage", { input: 10, output: 5, cacheRead: 3, cacheWrite: 2, model: "m" }],
  ]);
});
