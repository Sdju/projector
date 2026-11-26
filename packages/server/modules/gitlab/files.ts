import type { GitlabFile } from "@ai-projector/core/modules/gitlab/index.ts";
import { HttpError } from "../http/index.ts";
import { gitlabBytes, gitlabReader, type GitlabReader } from "./api.ts";
import { extension, projectId, refQuery, safePath } from "./repository-path.ts";

const FILE_LIMIT = 5 * 1024 * 1024;
const IMAGE_MIME: Record<string, string> = {
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  gif: "image/gif",
  webp: "image/webp",
  avif: "image/avif",
  ico: "image/x-icon",
  svg: "image/svg+xml",
};

interface ApiFile {
  file_path?: string;
  size?: number;
  encoding?: string;
  content?: string;
}

export async function browseGitlabFile(
  repository: string,
  ref: string,
  path: string,
): Promise<GitlabFile> {
  const reader = await gitlabReader(repository);
  return readGitlabFileAt(reader, projectId(reader.target.path), ref, path);
}

/** Read one file from an already resolved project id or path; used for both sides of an MR diff. */
export async function readGitlabFileAt(
  reader: GitlabReader,
  project: string,
  ref: string,
  path: string,
): Promise<GitlabFile> {
  safePath(path);
  const file = await reader.get<ApiFile>(
    `/projects/${project}/repository/files/${encodeURIComponent(path)}${refQuery(ref)}`,
  );
  if ((file.size ?? 0) > FILE_LIMIT) throw new HttpError(413, "Файл больше 5 MiB");
  let bytes: Buffer;
  if (!file.encoding || file.encoding === "text") bytes = Buffer.from(file.content || "", "utf8");
  else if (file.encoding === "base64") bytes = Buffer.from(file.content || "", "base64");
  else throw new HttpError(400, "GitLab вернул неподдерживаемую кодировку");
  if (bytes.length > FILE_LIMIT) throw new HttpError(413, "Файл больше 5 MiB");
  const content = bytes.toString("utf8");
  const binary = bytes.includes(0) || !Buffer.from(content, "utf8").equals(bytes);
  const mime = IMAGE_MIME[extension(path)];
  return {
    content: binary ? "" : content,
    image: mime ? `data:${mime};base64,${bytes.toString("base64")}` : null,
    binary,
    size: bytes.length,
  };
}

export async function browseGitlabAsset(repository: string, ref: string, path: string) {
  safePath(path);
  const { target } = await gitlabReader(repository);
  const { bytes, headers } = await gitlabBytes(
    target.base,
    `/projects/${projectId(target.path)}/repository/files/${encodeURIComponent(path)}/raw${refQuery(ref)}`,
    target.token,
    { tokenType: target.tokenType },
  );
  const declared = Number(headers.get("Content-Length") || 0);
  if (declared > FILE_LIMIT || bytes.length > FILE_LIMIT)
    throw new HttpError(413, "Файл больше 5 MiB");
  const content = headers.get("Content-Type")?.split(";")[0]?.trim().toLowerCase() || "";
  const mime =
    IMAGE_MIME[extension(path)] ||
    (content && content !== "application/octet-stream" ? content : "application/octet-stream");
  return { mime, bytes };
}
