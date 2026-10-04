import type { FileWrite, GitWrite, WorkspaceProfile } from "./profile.ts";
import { singletonTab } from "./tabs.ts";

const base = (projectId: string) => `/api/projects/${encodeURIComponent(projectId)}/workspace`;

async function send(url: string, method: string, body: unknown, failure: string) {
  const response = await fetch(url, {
    method,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || failure);
  return data;
}

/** The project directory served by the Projector backend: full capabilities. */
export function createLocalWorkspaceProfile(projectId: string): WorkspaceProfile {
  const read = async (action: string, params: Record<string, string>, signal?: AbortSignal) => {
    const response = await fetch(`${base(projectId)}/${action}?${new URLSearchParams(params)}`, {
      signal,
    });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || "Не удалось прочитать проект");
    return data;
  };
  return {
    id: "local",
    layout: "full",
    sidebar: [{ id: "docker", title: "Docker", command: "ide.docker.sidebar.open" }],
    tabs: [
      singletonTab("agent", "agent:chat", "Агент", "Чат с агентом Projector", {
        command: {
          id: "ide.workbench.agent.open",
          title: "Открыть чат с агентом",
          requires: "agent",
        },
      }),
      singletonTab("project", "settings:project", "Настройки проекта", "Настройки проекта"),
      singletonTab("docker", "docker:overview", "Docker", "Контейнеры и Compose"),
    ],
    features: {
      terminals: true,
      docker: true,
      agent: true,
      settings: true,
      persist: true,
      externalFiles: true,
    },
    providers: {
      files: {
        read,
        assetUrl: (path, external = false) =>
          `${base(projectId)}/${external ? "external-asset" : "asset"}?${new URLSearchParams({ path })}`,
        write: (endpoint: FileWrite, body, failure = "Не удалось выполнить действие") =>
          send(
            `${base(projectId)}/${endpoint}`,
            endpoint === "file" ? "PUT" : "POST",
            body,
            failure,
          ),
      },
      git: {
        read,
        write: (endpoint: GitWrite, body, failure = "Не удалось выполнить действие Git") =>
          send(`${base(projectId)}/${endpoint}`, "POST", body, failure),
      },
      search: { read },
    },
  };
}
