import type { IssueDetail } from "@ai-projector/core/modules/workspace/index.ts";
import {
  workspaceRequest,
  workspaceScopeRequest,
  type WorkspaceReadResult,
} from "../modules/workspace-api/index.ts";

/**
 * Проверки типов действий: файл не исполняется, его читает `vp check`.
 * Каждая директива `@ts-expect-error` упадёт, если ошибка перестанет ловиться компилятором.
 */
export async function typedWorkspaceActions(projectId: string) {
  const issues: number | null = (await workspaceRequest(projectId, "issues")).next;
  const branch: string = (await workspaceRequest(projectId, "git")).branch;
  const issue: IssueDetail = await workspaceRequest(projectId, "issue", { number: "7" });
  const file = await workspaceRequest(projectId, "file", { path: "README.md" });
  const readonly: boolean | undefined = file.readonly;
  const image: boolean | undefined = (
    await workspaceScopeRequest(projectId, { kind: "commit", rev: "a" }, "file", {
      path: "README.md",
    })
  ).image;
  const changed = (
    await workspaceScopeRequest(projectId, { kind: "compare", from: "a", to: "b" }, "changes")
  ).changes.length;
  const result: WorkspaceReadResult<"release"> = await workspaceRequest(projectId, "release", {
    tag: "v1",
  });
  const tag: string = result.release.tag;

  // @ts-expect-error неизвестного действия нет в карте
  await workspaceRequest(projectId, "issuez");
  // @ts-expect-error обязательный номер записи пропущен
  await workspaceRequest(projectId, "issue");
  // @ts-expect-error параметры другого действия не подходят
  await workspaceRequest(projectId, "issue", { id: "7" });
  // @ts-expect-error номер записи — строка
  await workspaceRequest(projectId, "issue", { number: 7 });
  // @ts-expect-error поиску в снимке нужен запрос
  await workspaceScopeRequest(projectId, { kind: "commit", rev: "a" }, "search");
  // @ts-expect-error сравнению файлов нужен путь
  await workspaceScopeRequest(projectId, { kind: "compare", from: "a", to: "b" }, "compare-file");
  // @ts-expect-error ответ другого действия не подходит по типу
  const notAnIssue: number = await workspaceRequest(projectId, "issue", { number: "7" });

  return { issues, branch, issue, readonly, image, changed, tag, notAnIssue };
}
