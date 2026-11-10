import { os } from "@ai-projector/core/modules/os/index.ts";
import { HttpError } from "../http/index.ts";
import { location } from "./paths.ts";

/**
 * Shows a project entry in the file manager of the machine running the server. The path is
 * resolved inside the project first, so the tree cannot reveal arbitrary disk locations.
 */
export async function revealProjectEntry(root: string, path: string) {
  if (path.includes("\\")) throw new HttpError(403, "Некорректный путь");
  const full = await location(root, path);
  await os.revealInFileManager(full);
  return { path };
}
