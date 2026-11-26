import { HttpError } from "../http/index.ts";

export const projectId = (path: string) => encodeURIComponent(path);

export function extension(path: string) {
  return path.split(".").pop()?.toLowerCase() || "";
}

export function safePath(path: string, message = "Неверный путь файла") {
  if (
    !path ||
    path.includes("\\") ||
    path.includes("\0") ||
    path.split("/").some((part) => !part || part === "." || part === "..")
  )
    throw new HttpError(400, message);
  return path;
}

export function refQuery(ref: string) {
  return ref ? `?${new URLSearchParams({ ref })}` : "";
}
