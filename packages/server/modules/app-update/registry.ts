import {
  HUB_PACKAGE,
  IDE_PACKAGE,
  NATIVE_PACKAGE,
  npmLatestUrl,
  readNpmLatest,
  type NpmLatest,
} from "@ai-projector/core/modules/app-update/index.ts";

const FETCH_MS = 4_000;
const MAX_BYTES = 256 * 1024;

export async function fetchNpmLatest(
  packageName: string,
  load: typeof fetch = fetch,
): Promise<NpmLatest> {
  const response = await load(npmLatestUrl(packageName), {
    headers: { Accept: "application/json" },
    redirect: "error",
    signal: AbortSignal.timeout(FETCH_MS),
  });
  if (!response.ok) throw new Error(`npm registry ответил ${response.status} для ${packageName}`);
  const length = Number(response.headers.get("content-length"));
  if (Number.isFinite(length) && length > MAX_BYTES)
    throw new Error(`Ответ npm registry для ${packageName} слишком большой`);
  const text = await response.text();
  if (text.length > MAX_BYTES)
    throw new Error(`Ответ npm registry для ${packageName} слишком большой`);
  return readNpmLatest(JSON.parse(text) as unknown, packageName);
}

export async function fetchPublishedVersions(
  installed: { native?: unknown; hub?: unknown },
  load: typeof fetch = fetch,
): Promise<{ ide: NpmLatest; native?: NpmLatest; hub?: NpmLatest }> {
  const ide = await fetchNpmLatest(IDE_PACKAGE, load);
  const [native, hub] = await Promise.all([
    installed.native ? fetchNpmLatest(NATIVE_PACKAGE, load).catch(() => undefined) : undefined,
    installed.hub ? fetchNpmLatest(HUB_PACKAGE, load).catch(() => undefined) : undefined,
  ]);
  return { ide, native, hub };
}
