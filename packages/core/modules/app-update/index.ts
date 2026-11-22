/** How this Projector tree was installed. Checkout never gets an npm upgrade offer. */
export type InstallSource = "checkout" | "npm" | "other";

export const IDE_PACKAGE = "@ai-projector/ide";
export const NATIVE_PACKAGE = "@ai-projector/native";
export const HUB_PACKAGE = "@ai-projector/hub";
export const MANAGED_BY_NPM_ENV = "PROJECTOR_MANAGED_BY_NPM";
export const UPDATE_CACHE_HOURS = 20;
export const RELEASE_NOTES_URL = "https://github.com/Sdju/projector/releases/tag";

export interface NpmLatest {
  name: string;
  version: string;
  tarball: string;
  integrity: string;
}

export interface UpdateCommand {
  package: string;
  command: string;
}

/** Reads `PROJECTOR_MANAGED_BY_NPM`; unknown values are ignored. */
export function managedByNpmFlag(value: string | undefined): boolean | undefined {
  if (value === "1" || value === "true") return true;
  if (value === "0" || value === "false") return false;
}

/** Distinguishes git checkout from a published `@ai-projector/ide` tree. */
export function detectInstallSource(input: {
  packageName?: string;
  packagePath: string;
  managedByNpm?: boolean;
}): InstallSource {
  const name = input.packageName?.trim();
  if (name === "projector") return "checkout";
  if (name !== IDE_PACKAGE) return "other";
  if (input.managedByNpm === false) return "other";
  if (input.managedByNpm === true) return "npm";
  const path = input.packagePath.replaceAll("\\", "/");
  if (path.includes("/node_modules/@ai-projector/ide")) return "npm";
  return "other";
}

export function npmLatestUrl(packageName: string): string {
  return `https://registry.npmjs.org/${packageName.replaceAll("/", "%2f")}/latest`;
}

/**
 * The `/latest` document is `dist-tags.latest`. Offer it only when tarball and integrity are
 * present, the same guard Codex uses before showing an npm update.
 */
export function readNpmLatest(value: unknown, expectedName: string): NpmLatest {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new Error("Ответ npm registry не является объектом");
  const record = value as Record<string, unknown>;
  const name = typeof record.name === "string" ? record.name : "";
  if (name !== expectedName) throw new Error(`npm registry вернул пакет ${name || "без имени"}`);
  const version = typeof record.version === "string" ? record.version.trim() : "";
  if (!version) throw new Error("npm registry не вернул версию");
  const dist =
    record.dist && typeof record.dist === "object" && !Array.isArray(record.dist)
      ? (record.dist as Record<string, unknown>)
      : undefined;
  const tarball = typeof dist?.tarball === "string" ? dist.tarball.trim() : "";
  const integrity = typeof dist?.integrity === "string" ? dist.integrity.trim() : "";
  if (!tarball.startsWith("https://"))
    throw new Error(`npm пакет ${expectedName}@${version} без HTTPS dist.tarball`);
  if (!integrity) throw new Error(`npm пакет ${expectedName}@${version} без dist.integrity`);
  return { name, version, tarball, integrity };
}

export function compareSemver(left: string, right: string): number {
  const [aCore, aPre] = left.replace(/^v/, "").split(/[-+]/, 2);
  const [bCore, bPre] = right.replace(/^v/, "").split(/[-+]/, 2);
  const a = aCore!.split(".").map(Number);
  const b = bCore!.split(".").map(Number);
  while (a.length < 3) a.push(0);
  while (b.length < 3) b.push(0);
  for (let index = 0; index < 3; index++) if (a[index] !== b[index]) return a[index]! - b[index]!;
  if (aPre === bPre) return 0;
  if (!aPre) return 1;
  if (!bPre) return -1;
  const aParts = aPre.split(".");
  const bParts = bPre.split(".");
  for (let index = 0; index < Math.max(aParts.length, bParts.length); index++) {
    const aPart = aParts[index];
    const bPart = bParts[index];
    if (aPart === bPart) continue;
    if (aPart === undefined) return -1;
    if (bPart === undefined) return 1;
    const aNumeric = /^\d+$/.test(aPart);
    const bNumeric = /^\d+$/.test(bPart);
    if (aNumeric && bNumeric) return Number(aPart) - Number(bPart);
    if (aNumeric !== bNumeric) return aNumeric ? -1 : 1;
    return aPart < bPart ? -1 : 1;
  }
  return 0;
}

export const isNewer = (latest: string, current: string) => compareSemver(latest, current) > 0;

export function releaseNotesUrl(version: string): string {
  return `${RELEASE_NOTES_URL}/v${version.replace(/^v/, "")}`;
}

export function updateCommands(input: {
  latest: string;
  native?: boolean;
  hub?: boolean;
}): UpdateCommand[] {
  const version = input.latest.replace(/^v/, "");
  const commands: UpdateCommand[] = [
    {
      package: IDE_PACKAGE,
      command: `npm install -g --allow-scripts=node-pty ${IDE_PACKAGE}@${version}`,
    },
  ];
  if (input.native)
    commands.push({
      package: NATIVE_PACKAGE,
      command: `npm install -g --allow-scripts=node-pty,node-gtk ${NATIVE_PACKAGE}@${version}`,
    });
  if (input.hub)
    commands.push({
      package: HUB_PACKAGE,
      command: `npm install -g ${HUB_PACKAGE}@${version}`,
    });
  return commands;
}

export function updateCommandText(commands: readonly UpdateCommand[]): string {
  return commands.map((item) => item.command).join("\n");
}

/** About may copy the command. Checkout never; dismiss does not hide the command. */
export function shouldOfferUpdate(input: {
  source: InstallSource;
  current?: string;
  latest?: string;
}): boolean {
  if (input.source === "checkout") return false;
  if (!input.current || !input.latest) return false;
  return isNewer(input.latest, input.current);
}

/** Inbox is npm-only and remembers one dismissed latest. */
export function shouldNotifyInbox(input: {
  source: InstallSource;
  current?: string;
  latest?: string;
  dismissed?: string;
}): boolean {
  if (input.source !== "npm") return false;
  if (input.dismissed && input.dismissed === input.latest) return false;
  return shouldOfferUpdate(input);
}
