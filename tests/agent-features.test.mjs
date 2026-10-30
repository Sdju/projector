import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { spawn } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { afterEach, beforeEach, describe, expect, it } from "vite-plus/test";
import { registerBuiltinAgentFeatures } from "../server/app/features.ts";
import { registerBuiltinWidgetDefinitions } from "../server/app/widgets.ts";
import {
  enabledFeatureText,
  featurePrompt,
  featureSettings,
  featuresFile,
  setFeatureAgent,
} from "../server/modules/agent-features/index.ts";
import { promptWithHistory } from "../server/modules/agent/agent-host.ts";
import { claudeSystemPrompt } from "../server/modules/agents/claude-code/claude-code-backend.ts";
import { buildSystemPrompt } from "../server/modules/agents/projector/prompts.ts";

registerBuiltinWidgetDefinitions();
registerBuiltinAgentFeatures();

let previous;
beforeEach(async () => {
  previous = process.env.XDG_DATA_HOME;
  process.env.XDG_DATA_HOME = await mkdtemp(join(tmpdir(), "projector-features-"));
});
afterEach(() => {
  if (previous === undefined) delete process.env.XDG_DATA_HOME;
  else process.env.XDG_DATA_HOME = previous;
});

const agentOf = (settings, agent) =>
  settings.features
    .find((feature) => feature.id === "widgets")
    .agents.find((item) => item.id === agent);

describe("agent features", () => {
  it("starts with the widgets on for Projector only", async () => {
    const settings = await featureSettings();
    const widgets = settings.features.find((feature) => feature.id === "widgets");
    expect(widgets.title).toBe("Виджеты в ответах");
    expect(widgets.agents.map((agent) => agent.id)).toEqual([
      "projector",
      "claude-code",
      "codex",
      "opencode",
      "cursor",
      "kimi",
    ]);
    expect(agentOf(settings, "projector").enabled).toBe(true);
    expect(agentOf(settings, "codex").enabled).toBe(false);
    expect(settings.file).toBe(featuresFile());
  });

  it("switches a feature for one agent and writes the choice", async () => {
    const settings = await setFeatureAgent("widgets", "codex", true);
    expect(agentOf(settings, "codex").enabled).toBe(true);
    expect(agentOf(settings, "projector").enabled).toBe(true);
    const stored = JSON.parse(await readFile(featuresFile(), "utf8"));
    expect(stored.features.widgets).toEqual(["projector", "codex"]);

    const prompt = await featurePrompt("codex");
    expect(prompt).toContain("[Projector]");
    expect(prompt).toContain("Виджеты в ответах");
    expect(prompt).toContain("Bars —");
    expect(await featurePrompt("cursor")).toBe("");

    const off = await setFeatureAgent("widgets", "codex", false);
    expect(agentOf(off, "codex").enabled).toBe(false);
    expect(await featurePrompt("codex")).toBe("");
  });

  it("removes the widget section from the Projector prompt when switched off", async () => {
    expect(buildSystemPrompt(await enabledFeatureText("projector"))).toContain(
      "Интерактивные блоки:",
    );
    await setFeatureAgent("widgets", "projector", false);
    expect(await enabledFeatureText("projector")).toBe("");
    expect(buildSystemPrompt(await enabledFeatureText("projector"))).not.toContain(
      "Интерактивные блоки",
    );
  });

  it("rejects an unknown feature or agent and survives a broken file", async () => {
    await expect(setFeatureAgent("nope", "codex", true)).rejects.toThrow("Неизвестная");
    await expect(setFeatureAgent("widgets", "nope", true)).rejects.toThrow("Неизвестный агент");

    await mkdir(join(process.env.XDG_DATA_HOME, "projector", "agent"), { recursive: true });
    await writeFile(featuresFile(), "{ broken", "utf8");
    const settings = await featureSettings();
    expect(agentOf(settings, "projector").enabled).toBe(true);
  });

  it("puts the feature text before the new message but after the replayed history", () => {
    const text = promptWithHistory("Новое", [{ role: "user", content: "Старое" }], "КОНТЕКСТ");
    expect(text.indexOf("Старое")).toBeLessThan(text.indexOf("КОНТЕКСТ"));
    expect(text.indexOf("КОНТЕКСТ")).toBeLessThan(text.indexOf("Новое сообщение"));
    expect(promptWithHistory("Новое", [], "КОНТЕКСТ")).toBe("КОНТЕКСТ\n\nНовое");
  });

  it("registers the features in the Claude Code runner process", async () => {
    // The runner is a composition of its own: without these registrations the catalog is empty
    // there, and a saved toggle silently adds nothing to the prompt.
    await setFeatureAgent("widgets", "claude-code", true);
    const url = (path) => pathToFileURL(fileURLToPath(new URL(path, import.meta.url))).href;
    const script = `
      const { featurePrompt } = await import(${JSON.stringify(url("../server/modules/agent-features/index.ts"))});
      await import(${JSON.stringify(url("../server/app/claude-runner.ts"))});
      process.stdout.write(await featurePrompt("claude-code"));
    `;
    const child = spawn(process.execPath, ["--input-type=module", "-e", script], {
      env: process.env,
    });
    let output = "";
    let errors = "";
    child.stdout.on("data", (chunk) => (output += chunk));
    child.stderr.on("data", (chunk) => (errors += chunk));
    const code = await new Promise((resolve) => child.on("close", resolve));
    expect(code, errors).toBe(0);
    expect(output).toContain("Bars —");
  });

  it("keeps the Claude Code prompt fresh so a toggle applies in a continued session", async () => {
    const off = await claudeSystemPrompt();
    expect(off).toMatchObject({ type: "preset", preset: "claude_code", snapshot: false });
    expect(off.append).toBeUndefined();

    await setFeatureAgent("widgets", "claude-code", true);
    const on = await claudeSystemPrompt();
    expect(on.snapshot).toBe(false);
    expect(on.append).toContain("Bars —");
  });

  it("the system prompt names the feature section only when the feature is on", () => {
    expect(buildSystemPrompt("Правило")).toContain("Интерактивные блоки:\nПравило");
    expect(buildSystemPrompt("")).not.toContain("Интерактивные блоки");
  });
});
