import { createHash } from "node:crypto";
import type { PluginManifest } from "@ai-projector/core/modules/plugins/index.ts";
import {
  projectTrustDescriptor,
  projectRoot,
  type ProjectTrustDescriptor,
  type ProjectTrustState,
  type TrustStore,
} from "../trusted-project-file/index.ts";
import { materializeProjectPlugin } from "./cache.ts";
import { projectPluginStateFile } from "./directory.ts";
import {
  scanProjectPlugins,
  type ProjectPluginCandidate,
  type ProjectPluginProblem,
} from "./scan.ts";
import { readProjectPluginState, updateProjectPluginState } from "./state.ts";

export function projectPluginRequiresTrust(manifest: PluginManifest): boolean {
  return (
    (manifest.projector.contributes.agents?.length ?? 0) > 0 ||
    (manifest.projector.contributes.balances?.length ?? 0) > 0 ||
    !!manifest.projector.server ||
    !!manifest.projector.browser
  );
}

function aggregate(
  packages: readonly { name: string; hash: string }[],
  problems: readonly ProjectPluginProblem[],
): string | undefined {
  if (!packages.length && !problems.length) return undefined;
  const hash = createHash("sha256");
  for (const item of [...packages].sort((left, right) => left.name.localeCompare(right.name)))
    hash.update(`p\0${item.name}\0${item.hash}\n`);
  for (const problem of [...problems].sort((left, right) =>
    `${left.name ?? ""}\0${left.message}`.localeCompare(`${right.name ?? ""}\0${right.message}`),
  ))
    hash.update(`e\0${problem.name ?? ""}\0${problem.message}\n`);
  return hash.digest("hex");
}

async function trustStateOfProject(projectId: string): Promise<ProjectTrustState> {
  let root: string;
  try {
    root = await projectRoot(projectId);
  } catch {
    return { root: "", exists: false, trusted: false, revoked: false };
  }
  const [scan, state] = await Promise.all([
    scanProjectPlugins(root).catch(() => ({ packages: [], problems: [] })),
    readProjectPluginState(),
  ]);
  const current = new Map(scan.packages.map((item) => [item.name, item.hash]));
  const saved = Object.entries(state[root] ?? {}).filter(([, entry]) => entry.trustedHash);
  // Only packages still present on disk (modified or broken) revoke trust; a deleted package
  // cannot execute and must not leave an un-dismissable notice behind.
  const revoked = saved.some(([name, entry]) =>
    current.has(name)
      ? current.get(name) !== entry.trustedHash
      : scan.problems.some((problem) => !problem.name || problem.name === name),
  );
  const hash = aggregate(scan.packages, scan.problems);
  return {
    root,
    exists: scan.packages.length > 0 || scan.problems.length > 0,
    trusted: saved.length > 0 && !revoked,
    ...(hash ? { hash } : {}),
    revoked,
  };
}

/**
 * The project plugin state is the trust record. A descriptor needs only the file name and the
 * roots with a decision; the per-package hashes stay in one device file next to `enabled`.
 */
const projectPluginTrustStore: TrustStore<{ hash: string }> = {
  file: projectPluginStateFile,
  read: async () => ({}),
  readSync: () => ({}),
  entry: async () => undefined,
  entrySync: () => undefined,
  set: async () => undefined,
  lock: (task) => task(),
  write: async () => undefined,
  roots: async () => Object.keys(await readProjectPluginState()),
};

/** The trust kind the project registry and inbox use for `.projector/plugins`. */
export const projectPluginsTrustDescriptor: ProjectTrustDescriptor = projectTrustDescriptor(
  "plugins",
  projectPluginTrustStore,
  trustStateOfProject,
);

function uniqueCandidate(
  packages: readonly ProjectPluginCandidate[],
  name: string,
): ProjectPluginCandidate {
  const matches = packages.filter((item) => item.name === name);
  if (!matches.length) throw new Error("Плагин проекта не найден");
  if (matches.length > 1) throw new Error("Обнаружены повторяющиеся пакеты с таким именем");
  return matches[0]!;
}

/** Trusts the exact current contents of one project package and turns it on. */
export async function setProjectPluginTrust(
  projectId: string,
  name: string,
  trusted: boolean,
): Promise<void> {
  const root = await projectRoot(projectId);
  const scan = await scanProjectPlugins(root);
  const candidate = uniqueCandidate(scan.packages, name);
  if (trusted && projectPluginRequiresTrust(candidate.manifest))
    await materializeProjectPlugin(candidate.source, root, name, candidate.hash);
  await updateProjectPluginState(root, name, (current) => {
    if (!trusted) return { ...current, enabled: false, trustedHash: undefined };
    return { ...current, enabled: true, trustedHash: candidate.hash };
  });
}

/** Enables or disables a package for this project; an untrusted package cannot be enabled. */
export async function setProjectPluginEnabled(
  projectId: string,
  name: string,
  enabled: boolean,
): Promise<void> {
  const root = await projectRoot(projectId);
  const scan = await scanProjectPlugins(root);
  const candidate = uniqueCandidate(scan.packages, name);
  const state = (await readProjectPluginState())[root]?.[name];
  const requiresTrust = projectPluginRequiresTrust(candidate.manifest);
  if (enabled && requiresTrust && state?.trustedHash !== candidate.hash)
    throw new Error("Сначала подтвердите доверие к коду плагина проекта");
  await updateProjectPluginState(root, name, (current) => ({ ...current, enabled }));
}
