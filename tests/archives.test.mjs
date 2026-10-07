import { expect, test } from "vite-plus/test";
import { mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFileSync } from "node:child_process";
import { previewProjectFile, readProjectFile } from "../server/modules/workspace/index.ts";

const fixtures = String.raw`
import io, tarfile, zipfile, gzip, bz2, lzma, sys
from pathlib import Path
root = Path(sys.argv[1])
for name, mode in [('sample.tar', 'w'), ('sample.tgz', 'w:gz'), ('sample.tar.gz', 'w:gz'), ('sample.tar.bz2', 'w:bz2'), ('sample.txz', 'w:xz')]:
    with tarfile.open(root / name, mode) as out:
        directory = tarfile.TarInfo('package'); directory.type = tarfile.DIRTYPE; out.addfile(directory)
        for path in ['package/hello world.txt', 'package/строка\nдругая.txt', '../outside.txt']:
            item = tarfile.TarInfo(path); item.size = 5; out.addfile(item, io.BytesIO(b'hello'))
        item = tarfile.TarInfo('package/link'); item.type = tarfile.SYMTYPE; item.linkname = '/etc/passwd'; out.addfile(item)
with zipfile.ZipFile(root / 'sample.zip', 'w') as out:
    out.writestr('package/', '')
    out.writestr('package/hello world.txt', 'hello')
with zipfile.ZipFile(root / 'many.zip', 'w') as out:
    for i in range(5001): out.writestr(str(i), '')
with tarfile.open(root / 'many.tar', 'w') as out:
    for i in range(5001): out.addfile(tarfile.TarInfo(str(i)))
with tarfile.open(root / 'empty.tar', 'w'): pass
for ext, encode in [('gz', gzip.compress), ('gzip', gzip.compress), ('bz2', bz2.compress), ('xz', lzma.compress)]:
    (root / ('plain.txt.' + ext)).write_bytes(encode(b'hello'))
(root / 'large.txt.gz').write_bytes(gzip.compress(b'x' * (256 * 1024 * 1024 + 1)))
(root / 'bad.tar.gz').write_bytes(gzip.compress(b'not a tar'))
`;

test("native archive previews handle tar/compression/zip, unusual names and links without extracting", async () => {
  const root = await mkdtemp(join(tmpdir(), "projector-archives-"));
  try {
    execFileSync("python3", ["-c", fixtures, root]);
    for (const path of [
      "sample.tar",
      "sample.tgz",
      "sample.tar.gz",
      "sample.tar.bz2",
      "sample.txz",
    ]) {
      const preview = await previewProjectFile(root, path);
      expect(preview.path).toBe(path);
      expect(preview.archive.entries.length).toBe(5);
      expect(preview.archive.entries[1].size).toBe(5);
      expect(preview.archive.entries[2].path).toBe("package/строка\nдругая.txt");
      expect(preview.archive.entries[3].path).toBe("../outside.txt");
      expect(preview.archive.entries[4].link).toBe("/etc/passwd");
      expect(preview.archive.entries[4].type).toBe("symlink");
      expect(preview.archive.truncated).toBe(false);
    }
    const zip = await previewProjectFile(root, "sample.zip");
    expect(zip.archive.format).toBe("ZIP");
    expect(zip.archive.entries[0].type).toBe("directory");
    expect(zip.archive.entries[1].size).toBe(5);
    for (const ext of ["gz", "gzip", "bz2", "xz"]) {
      const preview = await previewProjectFile(root, `plain.txt.${ext}`);
      expect(preview.archive.entries).toStrictEqual([{ path: "plain.txt", type: "file", size: 5 }]);
    }
    for (const path of ["many.zip", "many.tar"]) {
      const preview = await previewProjectFile(root, path);
      expect(preview.archive.truncated).toBe(true);
      expect(preview.archive.entries.length).toBe(5000);
    }
    expect((await previewProjectFile(root, "empty.tar")).archive.entries.length).toBe(0);
    await expect(previewProjectFile(root, "large.txt.gz")).rejects.toMatchObject({ status: 413 });
    await expect(previewProjectFile(root, "bad.tar.gz")).rejects.toMatchObject({ status: 422 });
    await writeFile(join(root, "broken.tgz"), "not gzip");
    await expect(previewProjectFile(root, "broken.tgz")).rejects.toMatchObject({ status: 422 });
    await expect(previewProjectFile(root, "../outside.tar")).rejects.toMatchObject({ status: 403 });
    await symlink("/etc/passwd", join(root, "external.tar"));
    await expect(previewProjectFile(root, "external.tar")).rejects.toMatchObject({ status: 403 });
    await writeFile(join(root, "readme.txt"), "text");
    expect((await previewProjectFile(root, "readme.txt")).content).toBe("text");
    await expect(readProjectFile(root, "sample.tar")).rejects.toMatchObject({ status: 415 });
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
