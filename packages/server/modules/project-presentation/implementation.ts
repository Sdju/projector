import type { ServerResponse } from "node:http";
import { createReadStream } from "node:fs";
import { randomUUID } from "node:crypto";

import { parseProjectCommands } from "@ai-projector/core/modules/project/index.ts";
import { getSnapshot } from "../processes/index.ts";

import type { LaunchMode, Project } from "../projects/index.ts";

import { iconContentType, letterIconSvg } from "../projects/index.ts";

import { asString, escapeHtml } from "../transport/index.ts";

export const parseCommands = parseProjectCommands;
export { scenarioFolder, scenarioUrl } from "@ai-projector/core/modules/project/index.ts";

export function parseMode(value: unknown): LaunchMode {
  return value === "window" ? "window" : "server";
}

export function sendIconFile(res: ServerResponse, file: string): void {
  res.statusCode = 200;
  res.setHeader("Content-Type", iconContentType(file));
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("Content-Security-Policy", "default-src 'none'; sandbox");
  createReadStream(file).pipe(res);
}

export function sendLetterIcon(res: ServerResponse, name: string): void {
  res.statusCode = 200;
  res.setHeader("Content-Type", "image/svg+xml");
  res.setHeader("Cache-Control", "no-cache");
  res.end(letterIconSvg(name));
}

/** Icon bytes from a remote repository; cached briefly so one page load stays one API pass. */
export function sendIconBytes(
  res: ServerResponse,
  mime: string,
  bytes: Buffer,
  cache = "private, max-age=300",
): void {
  res.statusCode = 200;
  res.setHeader("Content-Type", mime);
  res.setHeader("Cache-Control", cache);
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("Content-Security-Policy", "default-src 'none'; sandbox");
  res.end(bytes);
}

/** JSON is valid JS but not safe inside HTML: `</script>` would close the element. */
function scriptString(value: string): string {
  return JSON.stringify(value)
    .replaceAll("<", "\\u003c")
    .replaceAll(">", "\\u003e")
    .replaceAll("&", "\\u0026")
    .replaceAll("\u2028", "\\u2028")
    .replaceAll("\u2029", "\\u2029");
}

export function launchHtml(project: Project, target: string): string {
  const title = escapeHtml(project.name);
  const href = `/api/projects/${encodeURIComponent(project.id)}/icon`;
  return `<!doctype html>
<html lang="ru">
<head>
<meta charset="utf-8">
<title>${title}</title>
<link rel="icon" href="${href}">
<link rel="shortcut icon" href="${href}">
<meta http-equiv="refresh" content="0;url=${escapeHtml(target)}">
<style>html,body{margin:0;background:#111;color:#aaa;font:14px sans-serif;height:100%}body{display:grid;place-items:center}</style>
</head>
<body>
<p>открываю ${title}…</p>
<script>location.replace(${scriptString(target)})</script>
</body>
</html>`;
}

export function normalizeProject(input: Record<string, unknown>, current?: Project): Project {
  const commands = parseCommands(input.commands);
  if (commands.length === 0) throw new Error("Нужна хотя бы одна команда");
  const defaultCommandId =
    asString(input.defaultCommandId) || current?.defaultCommandId || commands[0].id;
  return {
    id: current?.id ?? randomUUID(),
    name: asString(input.name) || "без имени",
    path: current?.environment ? current.path : asString(input.path),
    environment: current?.environment,
    url: asString(input.url),
    icon: asString(input.icon),
    mode: parseMode(input.mode),
    defaultCommandId: commands.some((item) => item.id === defaultCommandId)
      ? defaultCommandId
      : commands[0].id,
    commands,
    createdAt: current?.createdAt ?? new Date().toISOString(),
  };
}

export function withRuntime(project: Project) {
  return { ...project, runtime: getSnapshot(project.id) };
}
