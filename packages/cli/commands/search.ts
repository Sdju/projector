import { printTable, writeJson, type Output } from "../common/output.ts";
import type { CliOptions } from "../modules/arguments/index.ts";
import type { ProjectorApi, SearchResponse } from "../modules/api/index.ts";

export async function commandSearch(
  api: ProjectorApi,
  options: CliOptions,
  query: string | undefined,
  out: Output,
): Promise<SearchResponse> {
  if (!query) throw new Error("Укажите запрос: projector search <запрос>");
  const result = await api.search(query);
  if (options.json) {
    writeJson(out, result);
    return result;
  }
  if (!result.items.length) {
    if (!options.quiet) out("Ничего не найдено");
    return result;
  }
  if (!options.quiet) {
    printTable(
      ["ТИП", "ИМЯ", "ОПИСАНИЕ", "МАРШРУТ"],
      result.items.map((item) => [item.kind, item.name, item.description, item.route ?? ""]),
      out,
    );
  }
  return result;
}
