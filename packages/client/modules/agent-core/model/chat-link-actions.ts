import { provide, type InjectionKey } from "vue";
import { absoluteLocalPath } from "../../../common/utilities/file-path.ts";
import { copyWithNotice, notify } from "../../../common/utilities/notice.ts";
import { workspaceRequest } from "../../workspace-api/index.ts";
import { chatProjectKey } from "../../chat-images/index.ts";
import type { ChatFileLink } from "../lib/chat-links.ts";

export interface ChatApi {
  executeCommand(
    command: string,
    args: Record<string, unknown>,
    options: { scope: string },
  ): Promise<unknown>;
}

/** What a chat link can do: open its file, copy its path, or copy the address. */
export interface ChatLinkActions {
  openFile(link: ChatFileLink, source?: Element): Promise<void>;
  copyAbsolute(link: ChatFileLink, source?: Element): Promise<void>;
  copyRelative(link: ChatFileLink, source?: Element): Promise<void>;
  copyAddress(href: string, source?: Element): Promise<void>;
}

export const chatLinkActionsKey: InjectionKey<ChatLinkActions> = Symbol("chat-link-actions");

/** Both things chat content needs from its project: image sources and link actions. */
export function provideChatContext(projectId: string, api?: ChatApi) {
  provide(chatProjectKey, projectId);
  if (api) provide(chatLinkActionsKey, chatLinkActions(projectId, api));
}

/** The path relative to the project root, tolerating another separator or drive-letter case. */
function projectRelative(path: string, base: string): string | undefined {
  if (!base) return;
  const drive = /^[a-z]:[\\/]/i.test(base) && /^[a-z]:[\\/]/i.test(path);
  const normalize = (value: string) => {
    const slash = value.replace(/\\/g, "/");
    return drive ? slash.toLowerCase() : slash;
  };
  if (!normalize(path).startsWith(`${normalize(base)}/`)) return;
  return path.slice(base.length + 1);
}

/** Link actions of one chat; the editor command scope is the project's workspace. */
export function chatLinkActions(projectId: string, api: ChatApi): ChatLinkActions {
  const scope = `editor:${projectId}`;
  let root: Promise<string> | undefined;
  function projectRoot() {
    root ??= workspaceRequest<{ root: string }>(projectId, "root")
      .then((data) => data.root)
      .catch((error) => {
        root = undefined;
        throw error;
      });
    return root;
  }
  function failure(cause: unknown, fallback: string) {
    return cause instanceof Error && cause.message ? cause.message : fallback;
  }
  async function openFile(link: ChatFileLink, source?: Element) {
    try {
      let path = link.path;
      let external = link.external;
      if (external) {
        // An absolute path inside the project is a project file: it stays editable. The link and
        // the project root may spell the separators differently (`C:/` and `C:\`).
        const base = (await projectRoot().catch(() => "")).replace(/[\\/]+$/, "");
        const relative = projectRelative(path, base);
        if (relative !== undefined) {
          path = relative;
          external = false;
        }
      }
      await api.executeCommand(
        "ide.editor.path.open",
        {
          path,
          ...(external ? { external: true } : {}),
          ...(link.line ? { line: link.line } : {}),
          ...(link.endLine ? { endLine: link.endLine } : {}),
          ...(link.column ? { column: link.column } : {}),
        },
        { scope },
      );
    } catch (cause) {
      notify(source, failure(cause, "Не удалось открыть файл"), "error");
    }
  }
  async function copyAbsolute(link: ChatFileLink, source?: Element) {
    try {
      const path = link.external ? link.path : absoluteLocalPath(await projectRoot(), link.path);
      await copyWithNotice(
        source,
        path,
        "Абсолютный путь скопирован",
        "Не удалось скопировать путь",
      );
    } catch (cause) {
      notify(source, failure(cause, "Не удалось скопировать путь"), "error");
    }
  }
  async function copyRelative(link: ChatFileLink, source?: Element) {
    await copyWithNotice(source, link.path, "Путь скопирован", "Не удалось скопировать путь");
  }
  async function copyAddress(href: string, source?: Element) {
    await copyWithNotice(source, href, "Ссылка скопирована", "Не удалось скопировать ссылку");
  }
  return { openFile, copyAbsolute, copyRelative, copyAddress };
}
