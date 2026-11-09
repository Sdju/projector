import { randomUUID } from "node:crypto";
import type { IncomingMessage } from "node:http";
import { isLocalRequest, accessAllowed } from "../../modules/access/index.ts";
import {
  projectDirectory,
  runSecretScript,
  SECRET_SHOW_LIMITS,
  SecretScriptError,
} from "../../modules/agent/index.ts";
import { broadcastEvent } from "../../modules/events/index.ts";
import { HttpError } from "../../modules/http/index.ts";
import { ideOwnerPage } from "../../modules/ide/index.ts";
import { asString, json, readBody, type RouteDefinition } from "../../modules/transport/index.ts";

function localOnly(req: IncomingMessage): void {
  if (!isLocalRequest(req))
    throw new HttpError(403, "Секрет можно показать только на локальной машине");
}

function text(value: unknown, limit: number): string {
  return typeof value === "string" ? value.slice(0, limit) : "";
}

/**
 * Two ways a secret reaches the person in front of the screen without entering the model context:
 * a page may ask the server to run the script (`reveal`), and a tool that already holds the value
 * may hand it to the live page (`push`). Neither response repeats the secret to the caller.
 */
export const routes: RouteDefinition[] = [
  {
    method: "POST",
    path: "/api/agent/secret-show/push",
    handler: async ({ req, res }) => {
      res.setHeader("Cache-Control", "no-store");
      localOnly(req);
      if (!accessAllowed(req, false)) throw new HttpError(403, "Доступ запрещён");
      const body = await readBody(req);
      const secret = typeof body.secret === "string" ? body.secret : "";
      if (!secret.trim() || secret.length > SECRET_SHOW_LIMITS.secret || secret.includes("\0"))
        throw new HttpError(400, "Недопустимый секрет");
      const label = text(body.label, SECRET_SHOW_LIMITS.label);
      const comment = text(body.comment, SECRET_SHOW_LIMITS.comment);
      const projectId = asString(body.projectId);
      const session = asString(body.session);
      const sent = broadcastEvent(
        "secret-show",
        {
          id: randomUUID(),
          secret,
          label,
          comment,
          ...(projectId ? { projectId } : {}),
          at: Date.now(),
        },
        session ? ideOwnerPage(session) : undefined,
        true,
      );
      if (!sent) {
        json(res, 200, {
          shown: false,
          delivered: false,
          error: "Страница Projector не открыта на этой машине",
        });
        return;
      }
      json(res, 200, { shown: true, delivered: true, label: label || "Секрет" });
    },
  },
  {
    method: "POST",
    path: "/api/agent/secret-show/reveal",
    handler: async ({ req, res }) => {
      res.setHeader("Cache-Control", "no-store");
      localOnly(req);
      if (!accessAllowed(req, true)) throw new HttpError(403, "Доступно только странице Projector");
      const body = await readBody(req);
      const script = typeof body.script === "string" ? body.script : "";
      if (!script.trim() || script.length > SECRET_SHOW_LIMITS.script)
        throw new HttpError(400, "Некорректный скрипт");
      const label = text(body.label, SECRET_SHOW_LIMITS.label);
      const comment = text(body.comment, SECRET_SHOW_LIMITS.comment);
      const cwd = await projectDirectory(asString(body.projectId));
      try {
        json(res, 200, {
          secret: await runSecretScript(script, cwd ? { cwd } : {}),
          ...(label ? { label } : {}),
          ...(comment ? { comment } : {}),
        });
      } catch (error) {
        const detail = error instanceof SecretScriptError ? error.detail : "";
        json(res, 400, {
          error: error instanceof Error ? error.message : "Скрипт не вернул секрет",
          ...(detail ? { detail } : {}),
        });
      }
    },
  },
];
