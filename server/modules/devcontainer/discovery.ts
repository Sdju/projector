import { createHash } from "node:crypto";
import { readFileSync, realpathSync, statSync } from "node:fs";
import { dirname, isAbsolute, join, relative, resolve } from "node:path";
import { parse, type ParseError } from "jsonc-parser";

const CANDIDATES = [".devcontainer/devcontainer.json", ".devcontainer.json"];
const MAX_BYTES = 256 * 1024;

export interface DevcontainerConfig {
  /** Absolute path, verified to stay inside the project. */
  file: string;
  relativePath: string;
  config: Record<string, unknown>;
  hash: string;
}
const inside = (root: string, path: string) => {
  const rel = relative(root, path);
  return rel !== "" && rel !== ".." && !rel.startsWith("../") && !isAbsolute(rel);
};
// Small files, read synchronously so the trust check can run inside synchronous terminal launches.
function readLimited(path: string) {
  if (statSync(path).size > MAX_BYTES) throw new Error("файл конфигурации слишком большой");
  return readFileSync(path);
}
function referencedFiles(config: Record<string, unknown>, directory: string) {
  const build = config.build as Record<string, unknown> | undefined;
  const compose = config.dockerComposeFile;
  const names = [
    ...(typeof config.dockerFile === "string" ? [config.dockerFile] : []),
    ...(typeof build?.dockerfile === "string" ? [build.dockerfile] : []),
    ...(typeof compose === "string" ? [compose] : Array.isArray(compose) ? compose : []),
  ].filter((name): name is string => typeof name === "string");
  return names.map((name) => resolve(directory, name));
}

/**
 * Finds the project's devcontainer.json. The hash covers the config plus the
 * Dockerfile and Compose files it builds from, so any of them changing
 * invalidates a previous trust decision.
 */
export function findDevcontainer(root: string): DevcontainerConfig | undefined {
  const base = realpathSync(root);
  for (const candidate of CANDIDATES) {
    let file: string;
    try {
      file = realpathSync(join(base, candidate));
    } catch {
      continue;
    }
    // A symlink pointing out of the project is never read or trusted.
    if (!inside(base, file)) continue;
    let bytes: Buffer;
    try {
      bytes = readLimited(file);
    } catch {
      continue;
    }
    const errors: ParseError[] = [];
    const parsed = parse(bytes.toString("utf8"), errors, { allowTrailingComma: true });
    const config =
      parsed && typeof parsed === "object" && !Array.isArray(parsed)
        ? (parsed as Record<string, unknown>)
        : {};
    const hash = createHash("sha256");
    hash.update(`${relative(base, file)}\0`).update(bytes);
    for (const extra of referencedFiles(config, dirname(file)).sort()) {
      hash.update(`\0${relative(base, extra)}\0`);
      let real: string | undefined;
      try {
        real = realpathSync(extra);
      } catch {
        /* Missing files still count: creating one later changes the hash. */
      }
      if (!real || !inside(base, real)) hash.update(real ? "outside" : "missing");
      else
        try {
          hash.update(readLimited(real));
        } catch {
          hash.update("unreadable");
        }
    }
    return {
      file,
      relativePath: relative(base, file),
      config: errors.length ? {} : config,
      hash: hash.digest("hex"),
    };
  }
}
