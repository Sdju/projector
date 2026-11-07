import { expect, test } from "vite-plus/test";
import { contentDisposition, downloadFilename } from "../packages/server/modules/http/index.ts";

test("release download names cannot break the attachment header", () => {
  expect(downloadFilename('app\r\n"/\\name.zip')).toBe("app_____name.zip");
  expect(downloadFilename("")).toBe("download");
  expect(downloadFilename("   ")).toBe("download");
  const unicode = contentDisposition("проект.zip");
  expect(unicode).toContain('filename="______.zip"');
  expect(unicode).toContain("filename*=UTF-8''%D0%BF%D1%80%D0%BE%D0%B5%D0%BA%D1%82.zip");
  expect(contentDisposition('bad"name.zip')).not.toContain('filename="bad"name.zip"');
  expect(Array.from(downloadFilename("😀".repeat(200)))).toHaveLength(180);
  expect(() => contentDisposition("😀".repeat(200))).not.toThrow();
});
