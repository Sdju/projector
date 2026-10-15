import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { dataDir } from "../../../core/modules/app-paths/index.ts";

export function gatewayConfigPath(): string {
  return join(dataDir(), "openai-gateway.json");
}

/** The gateway spends the user's provider quota, so it is off until switched on. */
export function gatewayEnabled(): boolean {
  try {
    const parsed = JSON.parse(readFileSync(gatewayConfigPath(), "utf8")) as { enabled?: unknown };
    return parsed.enabled === true;
  } catch {
    return false;
  }
}

export function setGatewayEnabled(enabled: boolean): void {
  const file = gatewayConfigPath();
  mkdirSync(dataDir(), { recursive: true });
  const temporary = `${file}.${process.pid}.tmp`;
  writeFileSync(temporary, `${JSON.stringify({ enabled })}\n`, { mode: 0o600 });
  renameSync(temporary, file);
}
