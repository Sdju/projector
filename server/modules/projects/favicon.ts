import { readFile, stat } from "node:fs/promises";
import { dirname, extname, join, resolve, sep } from "node:path";

const ICON_FILES = [
  "public/favicon.svg",
  "public/favicon.ico",
  "public/favicon.png",
  "public/favicon-32x32.png",
  "public/apple-touch-icon.png",
  "public/icon.svg",
  "public/icon.png",
  "public/logo.svg",
  "public/logo.png",
  "public/icons/icon.svg",
  "public/icons/icon-512.png",
  "favicon.svg",
  "favicon.ico",
  "src/favicon.svg",
  "src/assets/favicon.svg",
  "src/assets/favicon.ico",
  "src/assets/icon.svg",
  "src/assets/logo.svg",
  "src/assets/images/favicon.svg",
  "src/assets/images/logo.svg",
  "static/favicon.svg",
  "static/favicon.ico",
  "client/public/favicon.svg",
  "client/public/favicon.ico",
  "app/public/favicon.svg",
];

const HTML_FILES = ["index.html", "public/index.html", "src/index.html", "client/index.html"];

export const ICON_TYPES: Record<string, string> = {
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".gif": "image/gif",
};

export function isInside(root: string, file: string): boolean {
  const a = resolve(root);
  const b = resolve(file);
  return b === a || b.startsWith(`${a}${sep}`);
}

async function existsFile(file: string): Promise<boolean> {
  const info = await stat(file).catch(() => null);
  return Boolean(info?.isFile());
}

function resolveHref(projectDir: string, htmlFile: string, href: string): string[] {
  const trimmed = href.trim();
  if (!trimmed || trimmed.startsWith("data:") || /^https?:/i.test(trimmed)) return [];
  const clean = trimmed.split("?")[0]?.split("#")[0] ?? trimmed;
  if (clean.startsWith("/")) {
    const rel = clean.slice(1);
    return [
      join(projectDir, "public", rel),
      join(projectDir, "static", rel),
      join(projectDir, rel),
      join(dirname(htmlFile), rel),
    ];
  }
  return [resolve(dirname(htmlFile), clean), join(projectDir, "public", clean)];
}

async function iconFromHtml(projectDir: string): Promise<string | null> {
  for (const rel of HTML_FILES) {
    const htmlFile = join(projectDir, rel);
    const raw = await readFile(htmlFile, "utf8").catch(() => null);
    if (!raw) continue;
    const links = raw.slice(0, 48_000).match(/<link\b[^>]*>/gi) ?? [];
    for (const tag of links) {
      const relAttr = /rel=["']([^"']+)["']/i.exec(tag)?.[1]?.toLowerCase() ?? "";
      if (!relAttr.includes("icon")) continue;
      const href = /href=["']([^"']+)["']/i.exec(tag)?.[1];
      if (!href) continue;
      for (const candidate of resolveHref(projectDir, htmlFile, href)) {
        if (isInside(projectDir, candidate) && (await existsFile(candidate))) {
          return candidate;
        }
      }
    }
  }
  return null;
}

export async function findFavicon(projectDir: string): Promise<string | null> {
  const dir = resolve(projectDir);
  const fromHtml = await iconFromHtml(dir);
  if (fromHtml) return fromHtml;
  for (const rel of ICON_FILES) {
    const file = join(dir, rel);
    if (await existsFile(file)) return file;
  }
  return null;
}

export async function resolveProjectIcon(
  projectDir: string,
  stored?: string | null,
): Promise<string | null> {
  if (stored) {
    const file = stored.startsWith("/") ? stored : join(projectDir, stored);
    if (isInside(projectDir, file) && (await existsFile(file))) return file;
  }
  return findFavicon(projectDir);
}

export function letterIconSvg(name: string): string {
  const letter = (name.trim()[0] || "P").toUpperCase();
  const safe = letter.replace(/[^\p{L}\p{N}]/gu, "P").slice(0, 1) || "P";
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><rect width="64" height="64" rx="14" fill="#2c2c28"/><text x="32" y="42" text-anchor="middle" font-size="30" fill="#ecece6" font-family="sans-serif">${safe}</text></svg>`;
}

export function iconContentType(file: string): string {
  return ICON_TYPES[extname(file).toLowerCase()] ?? "application/octet-stream";
}
