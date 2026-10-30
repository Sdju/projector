import { loadProjects } from "../projects/index.ts";
import { resolveAgentBackend } from "./registry.ts";
import { selectionFrom } from "./controls.ts";
import { worktreeCwd, createWorktree } from "./worktrees.ts";
import { asString } from "../transport/index.ts";

import type { MessagePart } from "./index.ts";
import type { AgentHistoryTool, AgentHistoryTurn } from "../providers/index.ts";

/** Calls an earlier answer made; malformed ones are dropped, sizes bounded. */
function historyTools(value: unknown): AgentHistoryTool[] {
  if (!Array.isArray(value)) return [];
  return value.slice(0, 100).flatMap((item): AgentHistoryTool[] => {
    if (!item || typeof item !== "object") return [];
    const row = item as Record<string, unknown>;
    const id = asString(row.id);
    const name = asString(row.name);
    if (!id || !name) return [];
    return [
      {
        id: id.slice(0, 200),
        name: name.slice(0, 100),
        ...(typeof row.input === "string" ? { input: row.input.slice(0, 20_000) } : {}),
        output: asString(row.output).slice(0, 20_000),
        ...(row.failed === true ? { failed: true } : {}),
      },
    ];
  });
}

/** The chips of a message; anything that is not a well-formed part is dropped. */
function partsFrom(value: unknown): MessagePart[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const parts = value.flatMap((item): MessagePart[] => {
    if (!item || typeof item !== "object") return [];
    const part = item as Record<string, unknown>;
    if (part.type === "text" && typeof part.text === "string")
      return [{ type: "text", text: part.text }];
    if (part.type === "file" && typeof part.path === "string" && part.path)
      return [{ type: "file", path: part.path, directory: part.directory === true || undefined }];
    if (part.type === "command" && typeof part.name === "string" && part.name)
      return [{ type: "command", name: part.name }];
    if (
      part.type === "image" &&
      typeof part.id === "string" &&
      typeof part.name === "string" &&
      typeof part.mime === "string"
    )
      return [{ type: "image", id: part.id, name: part.name, mime: part.mime }];
    return [];
  });
  return parts.some((part) => part.type !== "text") ? parts.slice(0, 200) : undefined;
}

/** A new request from the body of `POST /api/agent`. */
export async function requestFrom(body: Record<string, unknown>) {
  const message = asString(body.message);
  if (!message) throw new Error("Напишите сообщение агенту");
  const projectId = asString(body.projectId);
  const project = projectId
    ? (await loadProjects()).find((item) => item.id === projectId)
    : undefined;
  if (projectId && !project) throw new Error("Проект не найден");
  let folder = project?.path;
  let worktree: { id: string; branch: string } | undefined;
  const reused = asString(body.worktree);
  if (project && reused) folder = await worktreeCwd(project.id, reused, project.path);
  else if (project && body.isolate === true && !asString(body.sessionId)) {
    const copy = await createWorktree(project.id, project.path);
    folder = copy.cwd;
    worktree = { id: copy.id, branch: copy.branch };
  }
  const history = Array.isArray(body.history)
    ? body.history.flatMap((item): AgentHistoryTurn[] => {
        if (!item || typeof item !== "object") return [];
        const row = item as Record<string, unknown>;
        const role = row.role === "assistant" ? "assistant" : row.role === "user" ? "user" : null;
        const content = asString(row.content);
        const tools = historyTools(row.tools);
        if (!role || (!content && !tools.length)) return [];
        return [{ role, content, ...(tools.length ? { tools } : {}) }];
      })
    : [];
  const request = {
    message,
    parts: partsFrom(body.parts),
    history,
    backend: resolveAgentBackend(body.backend),
    permissionMode: asString(body.permissionMode) || undefined,
    selection: selectionFrom(body.selection),
    sessionId: asString(body.sessionId) || undefined,
    messageId: asString(body.messageId) || undefined,
    tail: asString(body.tail) || undefined,
    features: Array.isArray(body.features)
      ? body.features.filter((id): id is string => typeof id === "string").slice(0, 50)
      : undefined,
    cwd: folder,
    providerId: asString(body.providerId) || undefined,
  };
  return { request, worktree };
}
