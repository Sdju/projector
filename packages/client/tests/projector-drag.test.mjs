import { expect, test } from "vite-plus/test";
import {
  isProjectorDrag,
  projectorDragType,
  readProjectorDrag,
  setProjectorDrag,
} from "../modules/path-drop/index.ts";
import { droppedTerminalPaths } from "../modules/terminal/lib/drop.ts";

function transfer(initial = {}) {
  const values = new Map(Object.entries(initial));
  return {
    get types() {
      return [...values.keys()];
    },
    getData: (type) => values.get(type) ?? "",
    setData(type, value) {
      values.set(type, String(value));
    },
  };
}

test("reads a plain file entry and keeps one selected path", () => {
  const data = transfer();
  setProjectorDrag(data, { projectId: "p", path: "src/a.ts", paths: ["src/a.ts"] });
  expect(isProjectorDrag(data)).toBe(true);
  expect(readProjectorDrag(data)).toStrictEqual({
    projectId: "p",
    path: "src/a.ts",
    paths: ["src/a.ts"],
  });
});

test("keeps a commit and its staged side, and drops broken selections", () => {
  const data = transfer({
    [projectorDragType]: JSON.stringify({
      projectId: "p",
      path: "src/a.ts",
      paths: ["src/a.ts", "", 42],
      commit: "abc123",
      staged: true,
    }),
  });
  expect(readProjectorDrag(data)).toStrictEqual({
    projectId: "p",
    path: "src/a.ts",
    paths: ["src/a.ts"],
    commit: "abc123",
    staged: true,
  });
});

test("ignores foreign and damaged data", () => {
  expect(isProjectorDrag(null)).toBe(false);
  expect(readProjectorDrag(transfer())).toBeUndefined();
  expect(readProjectorDrag(transfer({ [projectorDragType]: "not json" }))).toBeUndefined();
  expect(
    readProjectorDrag(transfer({ [projectorDragType]: JSON.stringify({ path: "a" }) })),
  ).toBeUndefined();
  expect(
    readProjectorDrag(transfer({ [projectorDragType]: JSON.stringify({ projectId: "p" }) })),
  ).toBeUndefined();
});

test("the terminal takes the path of a commit file and ignores its hash", async () => {
  const data = transfer();
  setProjectorDrag(data, {
    projectId: "p",
    path: "src/a.ts",
    paths: ["src/a.ts"],
    commit: "abc123",
  });
  const paths = await droppedTerminalPaths(
    data,
    () => {
      throw new Error("Unexpected upload");
    },
    async (projectId, path) => {
      expect(projectId).toBe("p");
      expect(path).toBe("src/a.ts");
      return `/project/${path}`;
    },
  );
  expect(paths).toStrictEqual(["/project/src/a.ts"]);
});
