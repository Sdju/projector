import { execFile, spawn } from "node:child_process";
import { promisify } from "node:util";
import type { SecretKey } from "../../contract.ts";

const execute = promisify(execFile);
const SECURITY = "/usr/bin/security";
const encode = (value: string) => Buffer.from(value, "utf8").toString("base64");
const quote = (value: string) => `"${value.replace(/["\\]/g, "\\$&")}"`;

/** Runs `security -i` so the secret travels over stdin, not through argv visible in `ps`. */
function interactive(command: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(SECURITY, ["-i"], { stdio: ["pipe", "ignore", "pipe"] });
    let stderr = "";
    child.stderr.on("data", (chunk) => (stderr += chunk));
    child.on("error", reject);
    child.on("close", (code) =>
      code === 0 && !/SecKeychain|security:/.test(stderr)
        ? resolve()
        : reject(new Error(`Keychain: ${stderr.trim() || `код ${code}`}`)),
    );
    child.stdin.end(`${command}\n`);
  });
}

export async function secretsAvailable(): Promise<boolean> {
  try {
    await execute(SECURITY, ["default-keychain"], { timeout: 5000 });
    return true;
  } catch {
    return false;
  }
}
export async function getSecret({ service, account }: SecretKey): Promise<string | undefined> {
  try {
    const { stdout } = await execute(
      SECURITY,
      ["find-generic-password", "-s", service, "-a", account, "-w"],
      { timeout: 120_000 },
    );
    return Buffer.from(stdout.trim(), "base64").toString("utf8");
  } catch (error) {
    if ((error as { code?: number }).code === 44) return undefined;
    throw error;
  }
}
export async function setSecret(
  { service, account }: SecretKey,
  label: string,
  value: string,
): Promise<void> {
  await interactive(
    `add-generic-password -U -s ${quote(service)} -a ${quote(account)} -l ${quote(label)} -w ${quote(encode(value))}`,
  );
}
export async function deleteSecret({ service, account }: SecretKey): Promise<void> {
  try {
    await execute(SECURITY, ["delete-generic-password", "-s", service, "-a", account], {
      timeout: 120_000,
    });
  } catch (error) {
    if ((error as { code?: number }).code !== 44) throw error;
  }
}
