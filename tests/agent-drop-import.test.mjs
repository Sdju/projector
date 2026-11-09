import { expect, test } from "vite-plus/test";
import { registerWorkspaceProfile } from "../packages/client/modules/workspace-api/index.ts";
import { importDroppedEntries } from "../packages/client/modules/agent/lib/drop-import.ts";

function profile(uploads, conflicts = []) {
  return {
    id: "drop-project",
    layout: "editor",
    features: {},
    providers: {
      files: {
        assetUrl: () => "",
        read: async () => ({}),
        write: async (endpoint, body) => {
          if (endpoint !== "import" || body.action !== "check")
            throw new Error(`unexpected write: ${endpoint}`);
          return { conflicts: conflicts.filter((item) => body.names.includes(item.name)) };
        },
        upload: async (directory, path, body) => {
          uploads.push({ directory, path, body });
          return { destination: path };
        },
      },
    },
  };
}

test("a dropped folder is uploaded into the project with free names", async () => {
  const uploads = [];
  const disconnect = registerWorkspaceProfile(
    "drop-project",
    profile(uploads, [{ name: "taken.txt", free: "taken (2).txt" }]),
  );
  try {
    const chips = await importDroppedEntries("drop-project", [
      { path: "taken.txt", file: new File(["a"], "taken.txt") },
      { path: "photos/one.png", file: new File(["b"], "one.png") },
      { path: "empty" },
    ]);
    expect(uploads.map(({ directory, path }) => ({ directory, path }))).toStrictEqual([
      { directory: "", path: "taken (2).txt" },
      { directory: "", path: "photos/one.png" },
      { directory: "", path: "empty" },
    ]);
    expect(chips).toStrictEqual([
      { type: "file", path: "taken (2).txt" },
      { type: "file", path: "photos", directory: true },
      { type: "file", path: "empty", directory: true },
    ]);
  } finally {
    disconnect();
  }
});

test("a project without uploads refuses dropped desktop files", async () => {
  const disconnect = registerWorkspaceProfile("drop-readonly", {
    ...profile([]),
    providers: { files: { ...profile([]).providers.files, upload: undefined } },
  });
  try {
    await expect(
      importDroppedEntries("drop-readonly", [
        { path: "note.txt", file: new File(["a"], "note.txt") },
      ]),
    ).rejects.toThrow(/не принимает загрузку/);
  } finally {
    disconnect();
  }
});

test("an unreadable drop is reported instead of silently doing nothing", async () => {
  const disconnect = registerWorkspaceProfile("drop-empty", profile([]));
  try {
    await expect(importDroppedEntries("drop-empty", [])).rejects.toThrow(/Не удалось прочитать/);
  } finally {
    disconnect();
  }
});
