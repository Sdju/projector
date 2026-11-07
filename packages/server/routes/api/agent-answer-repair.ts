import { accessAllowed } from "../../modules/access/index.ts";
import { HttpError } from "../../modules/http/index.ts";
import { repairAnswer } from "../../modules/agents/projector/index.ts";
import { asString, json, readBody } from "../../modules/transport/index.ts";
import type { RouteDefinition } from "../../modules/transport/index.ts";

/** One asynchronous Answer Doctor turn: the page validates the result and may ask again. */
export const routes: RouteDefinition[] = [
  {
    method: "POST",
    path: "/api/agent/answer-repair",
    handler: async ({ req, res }) => {
      if (!accessAllowed(req, true))
        throw new HttpError(403, "Восстановление ответа доступно только со страницы Projector");
      const body = await readBody(req);
      const answer = asString(body.answer);
      const error = asString(body.error);
      if (!answer.trim()) throw new Error("Не передан ответ для восстановления");
      const selection =
        body.selection && typeof body.selection === "object" && !Array.isArray(body.selection)
          ? Object.fromEntries(
              Object.entries(body.selection)
                .filter(([, value]) => typeof value === "string")
                .slice(0, 20),
            )
          : undefined;
      const abort = new AbortController();
      res.on("close", () => abort.abort());
      const repaired = await repairAnswer({
        answer,
        error,
        history: asString(body.history),
        selection,
        signal: abort.signal,
      });
      json(res, 200, { answer: repaired });
    },
  },
];
