import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { dataDir } from "../../../core/modules/app-paths/index.ts";
import {
  JUDGE_DEFAULTS,
  normalizeJudgeSettings,
  type JudgeSettings,
} from "../../../core/modules/agent-judge/index.ts";
import { writeFileAtomic } from "../providers/index.ts";

const file = () => join(dataDir(), "agent", "judge.json");

/** Global judge settings; a damaged or missing file means the defaults. */
export async function readJudgeSettings(): Promise<JudgeSettings> {
  try {
    const parsed = JSON.parse(await readFile(file(), "utf8")) as unknown;
    return normalizeJudgeSettings(parsed);
  } catch {
    return { ...JUDGE_DEFAULTS };
  }
}

/** Writes only valid values: scores 4 and 5 can never become automatic. */
export async function writeJudgeSettings(value: unknown): Promise<JudgeSettings> {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    const row = value as Record<string, unknown>;
    if (row.maxRisk !== undefined && row.maxRisk !== 1 && row.maxRisk !== 2 && row.maxRisk !== 3)
      throw new Error("maxRisk должен быть 1, 2 или 3: более высокий риск не автоматизируется");
    if (
      row.confidence !== undefined &&
      row.confidence !== "high" &&
      row.confidence !== "high-medium"
    )
      throw new Error("confidence должен быть high или high-medium");
    if (row.show !== undefined && typeof row.show !== "boolean")
      throw new Error("show должен быть boolean");
    if (row.auto !== undefined && typeof row.auto !== "boolean")
      throw new Error("auto должен быть boolean");
  }
  const settings = normalizeJudgeSettings(value);
  await writeFileAtomic(file(), `${JSON.stringify(settings, null, 2)}\n`);
  return settings;
}
