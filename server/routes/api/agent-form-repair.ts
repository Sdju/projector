import { accessAllowed } from "../../modules/access/index.ts";
import { HttpError } from "../../modules/http/index.ts";
import { repairForm } from "../../modules/agents/projector/index.ts";
import { asString, json, readBody } from "../../modules/transport/index.ts";
import type { RouteContext } from "../../modules/transport/index.ts";

/** One asynchronous Form Doctor turn: the page validates the result and may ask again. */
export async function handleAgentFormRepair({
  req,
  res,
  method,
  path,
}: RouteContext): Promise<boolean> {
  if (path !== "/api/agent/form-repair" || method !== "POST") return false;
  if (!accessAllowed(req, true))
    throw new HttpError(403, "Восстановление формы доступно только со страницы Projector");
  const body = await readBody(req);
  const form = asString(body.form);
  const error = asString(body.error);
  if (!form.trim()) throw new Error("Не передана форма для восстановления");
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
  const repaired = await repairForm({
    form,
    error,
    history: asString(body.history),
    selection,
    signal: abort.signal,
  });
  json(res, 200, { form: repaired });
  return true;
}
