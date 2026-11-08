import { expect, test } from "vite-plus/test";
import { refLabel, sourceLabel } from "../packages/core/modules/workspace/pipeline-status.ts";
import { countRu } from "../packages/client/common/utilities/plural.ts";

test("pipeline refs drop GitLab prefixes and name merge requests", () => {
  expect(refLabel("refs/merge-requests/267267/merge")).toBe("!267267");
  expect(refLabel("refs/merge-requests/267267/head")).toBe("!267267");
  expect(refLabel("refs/merge-requests/267267/train")).toBe("!267267 train");
  expect(refLabel("refs/heads/main")).toBe("main");
  expect(refLabel("refs/tags/v1.2.3")).toBe("v1.2.3");
  expect(refLabel("workloads/abc")).toBe("workloads/abc");
  expect(refLabel("")).toBe("");
});

test("pipeline sources have short human labels", () => {
  expect(sourceLabel("merge_request_event")).toBe("MR");
  expect(sourceLabel("pull_request")).toBe("PR");
  expect(sourceLabel("workflow_dispatch")).toBe("вручную");
  expect(sourceLabel("push")).toBe("push");
  expect(sourceLabel("schedule")).toBe("расписание");
  expect(sourceLabel("custom_source")).toBe("custom_source");
  expect(sourceLabel("")).toBe("");
});

test("countRu picks the Russian plural form", () => {
  expect(countRu(1, "коммит", "коммита", "коммитов")).toBe("1 коммит");
  expect(countRu(2, "коммит", "коммита", "коммитов")).toBe("2 коммита");
  expect(countRu(5, "коммит", "коммита", "коммитов")).toBe("5 коммитов");
  expect(countRu(11, "коммит", "коммита", "коммитов")).toBe("11 коммитов");
  expect(countRu(21, "коммит", "коммита", "коммитов")).toBe("21 коммит");
  expect(countRu(0, "файл", "файла", "файлов")).toBe("0 файлов");
});
