import { createHash } from "node:crypto";
import { mkdir, readFile, realpath } from "node:fs/promises";
import { basename, dirname, isAbsolute, join, relative } from "node:path";
import type { ProjectTrustKind } from "@ai-projector/core/modules/trust-notices/index.ts";
import { withFileLock } from "../atomic-files/index.ts";
import { loadProjects } from "../projects/index.ts";
import type { TrustRecord, TrustStore } from "./trust-file.ts";

/** SHA-256 содержимого: единственное, что связывает доверие с байтами файла. */
export function contentHash(text: string | Buffer): string {
  return createHash("sha256").update(text).digest("hex");
}

/** Настоящий каталог проекта — ключ решения о доверии; id проекта может переименоваться. */
export async function projectRoot(projectId: string): Promise<string> {
  const project = (await loadProjects()).find((item) => item.id === projectId);
  if (!project) throw new Error("Проект не найден");
  return realpath(project.path);
}

function outside(root: string, path: string): boolean {
  const rel = relative(root, path);
  return rel.startsWith("..") || isAbsolute(rel);
}

/** Файл проекта: symlink, ведущий за его пределы, не читается и не доверяется. */
export async function safeProjectFile(root: string, file: string, escape: string): Promise<string> {
  const real = await realpath(file);
  if (outside(root, real)) throw new Error(escape);
  return real;
}

/** Куда писать файл проекта: каталог создан и не выходит за проект через symlink. */
export async function projectWriteTarget(
  root: string,
  relativeFile: string,
  escape: string,
): Promise<string> {
  const file = join(root, relativeFile);
  await mkdir(dirname(file), { recursive: true });
  // Сам `.projector` может быть symlink'ом за пределы проекта.
  const realDirectory = await realpath(dirname(file));
  if (outside(root, realDirectory)) throw new Error(escape);
  return join(realDirectory, basename(file));
}

/** Состояние доверия к одному файлу проекта; `savedHash` — что запомнил пользователь. */
export interface ProjectTrustState {
  root: string;
  exists: boolean;
  trusted: boolean;
  hash?: string;
  savedHash?: string;
  /** Сохранённый хеш не совпадает с текущим: доверие отозвано. */
  revoked: boolean;
}

export interface ProjectFileTrust extends ProjectTrustState {
  file: string;
}

export interface TrustedProjectFile<Value> extends ProjectFileTrust {
  value: Value;
  problem?: string;
}

export interface TrustedProjectFileSpec<Value, Entry extends TrustRecord> {
  projectId: string;
  /** Путь файла относительно корня проекта. */
  relativeFile: string;
  trust: TrustStore<Entry>;
  /** Разбор содержимого; при повреждении бросает Error с готовым сообщением. */
  parse: (text: string) => Value;
  /** Что видят потребители, пока файла нет или он повреждён. */
  fallback: Value;
  /** Сообщение о symlink-выходе за пределы проекта. */
  escape: string;
  /** Сообщение, если файл не удалось прочитать по другой причине. */
  unreadable: string;
}

async function readAt<Value, Entry extends TrustRecord>(
  root: string,
  spec: TrustedProjectFileSpec<Value, Entry>,
): Promise<TrustedProjectFile<Value>> {
  const source = join(root, spec.relativeFile);
  const entry = await spec.trust.entry(root);
  let raw: string;
  try {
    raw = await readFile(source, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT")
      return {
        root,
        file: source,
        exists: false,
        trusted: false,
        savedHash: entry?.hash,
        revoked: false,
        value: spec.fallback,
      };
    return {
      root,
      file: source,
      exists: false,
      trusted: false,
      savedHash: entry?.hash,
      revoked: false,
      value: spec.fallback,
      problem: error instanceof Error ? error.message : spec.unreadable,
    };
  }
  const hash = contentHash(raw);
  const trusted = entry?.hash === hash;
  const revoked = !!entry && !trusted;
  let file: string;
  try {
    file = await safeProjectFile(root, source, spec.escape);
  } catch (error) {
    return {
      root,
      file: source,
      exists: false,
      trusted: false,
      revoked: false,
      value: spec.fallback,
      problem: error instanceof Error ? error.message : spec.unreadable,
    };
  }
  try {
    return {
      root,
      file,
      exists: true,
      trusted,
      hash,
      savedHash: entry?.hash,
      revoked,
      value: spec.parse(raw),
    };
  } catch (error) {
    return {
      root,
      file,
      exists: true,
      trusted: false,
      hash,
      savedHash: entry?.hash,
      revoked,
      value: spec.fallback,
      problem: error instanceof Error ? error.message : spec.unreadable,
    };
  }
}

/** Читает файл проекта вместе с решением о доверии; повреждённый файл не используется. */
export async function readTrustedProjectFile<Value, Entry extends TrustRecord>(
  spec: TrustedProjectFileSpec<Value, Entry>,
): Promise<TrustedProjectFile<Value>> {
  return readAt(await projectRoot(spec.projectId), spec);
}

/** Что происходит с доверием, когда Projector сам перезаписал файл проекта. */
export type TrustAfterWrite =
  /** Доверие определяется хешем: изменённый файл ждёт нового подтверждения. */
  | "rehash"
  /** Доверие сохраняется: файл уже был доверен или создан самим Projector. */
  | "keep"
  /** Доверие сбрасывается всегда, даже если байты совпали. */
  | "reset";

export interface TrustedProjectFileWrite<
  Value,
  Entry extends TrustRecord,
> extends TrustedProjectFileSpec<Value, Entry> {
  change: (value: Value) => Value;
  /** Запись самого файла проекта: формат и права остаются у владельца вида. */
  write: (root: string, value: Value) => Promise<void>;
  /** Новая запись файла доверия для политики `keep`. */
  record: (hash: string) => Entry;
  afterWrite?: TrustAfterWrite;
}

/**
 * Правка файла проекта: чтение, изменение, запись и решение о доверии под очередью самого файла.
 * Политику задаёт вид файла: пресеты, созданные в Projector, остаются доверенными, роли проекта
 * всегда требуют нового подтверждения, а оформление живёт по совпадению хеша.
 */
export async function writeTrustedProjectFile<Value, Entry extends TrustRecord>(
  spec: TrustedProjectFileWrite<Value, Entry>,
): Promise<TrustedProjectFile<Value>> {
  const root = await projectRoot(spec.projectId);
  return withFileLock(join(root, spec.relativeFile), async () => {
    const state = await readAt(root, spec);
    if (state.problem) throw new Error(state.problem);
    const policy = spec.afterWrite ?? "rehash";
    const keep = policy === "keep" && (!state.exists || state.trusted);
    await spec.write(state.root, spec.change(state.value));
    if (policy === "reset") await spec.trust.set(state.root, null);
    if (keep) {
      const next = await readAt(root, spec);
      if (next.hash && !next.problem) await spec.trust.set(state.root, spec.record(next.hash));
    }
    return readAt(root, spec);
  });
}

export interface ProjectTrustDescriptor {
  /** Вид доверия из уведомлений: appearance, roles, widgets, presets, devcontainer. */
  kind: ProjectTrustKind;
  trustFile: () => string;
  /** Текущее доверие; проект мог исчезнуть из каталога, тогда состояние недоступно. */
  stateFor: (projectId: string) => Promise<ProjectTrustState>;
  /** Каталоги проектов, у которых уже есть сохранённое решение. */
  storedRoots: () => Promise<string[]>;
}

/** Доверие к файлу проекта без его содержимого — вход реестра `project-trust`. */
export function trustStateOf(file: ProjectFileTrust): ProjectTrustState {
  return {
    root: file.root,
    exists: file.exists,
    trusted: file.trusted,
    hash: file.hash,
    savedHash: file.savedHash,
    revoked: file.revoked,
  };
}

/** Описание вида доверия для `project-trust`: реестр перечисляет только эти дескрипторы. */
export function projectTrustDescriptor<Entry extends TrustRecord>(
  kind: ProjectTrustKind,
  trust: TrustStore<Entry>,
  read: (projectId: string) => Promise<ProjectTrustState>,
): ProjectTrustDescriptor {
  return {
    kind,
    trustFile: trust.file,
    stateFor: read,
    storedRoots: () => trust.roots().catch(() => []),
  };
}
