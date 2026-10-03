import { github } from "./github.ts";
import { integrationConfig } from "./store.ts";
import { HttpError } from "../http/index.ts";
import type { DirectoryListing } from "../../../core/modules/directories/index.ts";

/** Repository siblings for breadcrumbs and typed gh:/owner/repository prefixes. */
export async function browseGithubDirectories(
  path: string, complete: boolean,
): Promise<DirectoryListing> {
  const match = /^gh:\/([A-Za-z0-9][A-Za-z0-9-]*)(?:\/([A-Za-z0-9_.-]*))?$/.exec(path);
  if (!match) throw new HttpError(400, "Укажите gh:/owner/ для выбора репозитория");
  const [, owner, fragment = ""] = match;
  const config = await integrationConfig("github");
  const token = config.enabled ? config.credentials.token || "" : "";
  const account = await github<{ type: string }>(`/users/${owner}`, token);
  const endpoint = account.type === "Organization"
    ? `/orgs/${owner}/repos`
    : token && config.credentials.login?.toLowerCase() === owner!.toLowerCase()
      ? "/user/repos" : `/users/${owner}/repos`;
  const entries: DirectoryListing["entries"] = [];
  let truncated = false;
  for (let page = 1; page <= 10; page++) {
    const repos = await github<Array<{ name: string; full_name: string }>>(
      `${endpoint}?per_page=100&page=${page}&sort=full_name&type=${endpoint === "/user/repos" ? "owner" : "all"}`,
      token,
    );
    for (const repo of repos) {
      if (repo.full_name.split("/")[0]!.toLowerCase() !== owner!.toLowerCase()) continue;
      if (complete && !repo.name.toLowerCase().startsWith(fragment.toLowerCase())) continue;
      entries.push({ name: repo.name, path: `gh:/${repo.full_name}` });
    }
    if (repos.length < 100) break;
    truncated = page === 10;
  }
  entries.sort((a, b) => a.name.localeCompare(b.name));
  return { path: `gh:/${owner}`, entries, truncated };
}
