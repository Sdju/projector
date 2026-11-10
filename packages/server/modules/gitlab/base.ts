import { join } from "node:path";
import { HttpError } from "../http/index.ts";
import { fieldText as text } from "../integration-store/index.ts";
import { os } from "@ai-projector/core/modules/os/index.ts";

export const GITLAB_URL = "https://gitlab.com";
export const GITLAB_DIRECTORY = join(os.homeDirectory(), "Projects");

/** Normalized instance origin (`https://gitlab.example.com[/prefix]`); credentials and queries are rejected. */
export function gitlabBaseUrl(value: unknown): string {
  const raw = text(value) || GITLAB_URL;
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new HttpError(400, "Укажите адрес GitLab вида https://gitlab.example.com");
  }
  if (
    !["https:", "http:"].includes(url.protocol) ||
    url.username ||
    url.password ||
    url.search ||
    url.hash
  )
    throw new HttpError(400, "Укажите адрес GitLab вида https://gitlab.example.com");
  return `${url.origin}${url.pathname.replace(/\/+$/, "")}`;
}
