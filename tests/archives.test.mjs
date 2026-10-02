import assert from "node:assert/strict";
import { test } from "node:test";
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
      assert.equal(preview.path, path);
      assert.equal(preview.archive.entries.length, 5);
      assert.equal(preview.archive.entries[1].size, 5);
      assert.equal(preview.archive.entries[2].path, "package/строка\nдругая.txt");
      assert.equal(preview.archive.entries[3].path, "../outside.txt");
      assert.equal(preview.archive.entries[4].link, "/etc/passwd");
      assert.equal(preview.archive.entries[4].type, "symlink");
      assert.equal(preview.archive.truncated, false);
    }
    const zip = await previewProjectFile(root, "sample.zip");
    assert.equal(zip.archive.format, "ZIP");
    assert.equal(zip.archive.entries[0].type, "directory");
    assert.equal(zip.archive.entries[1].size, 5);
    for (const ext of ["gz", "gzip", "bz2", "xz"]) {
      const preview = await previewProjectFile(root, `plain.txt.${ext}`);
      assert.deepEqual(preview.archive.entries, [{ path: "plain.txt", type: "file", size: 5 }]);
    }
    for (const path of ["many.zip", "many.tar"]) {
      const preview = await previewProjectFile(root, path);
      assert.equal(preview.archive.truncated, true);
      assert.equal(preview.archive.entries.length, 5000);
    }
    assert.equal((await previewProjectFile(root, "empty.tar")).archive.entries.length, 0);
    await assert.rejects(previewProjectFile(root, "large.txt.gz"), { status: 413 });
    await assert.rejects(previewProjectFile(root, "bad.tar.gz"), { status: 422 });
    await writeFile(join(root, "broken.tgz"), "not gzip");
    await assert.rejects(previewProjectFile(root, "broken.tgz"), { status: 422 });
    await assert.rejects(previewProjectFile(root, "../outside.tar"), { status: 403 });
    await symlink("/etc/passwd", join(root, "external.tar"));
    await assert.rejects(previewProjectFile(root, "external.tar"), { status: 403 });
    await writeFile(join(root, "readme.txt"), "text");
    assert.equal((await previewProjectFile(root, "readme.txt")).content, "text");
    await assert.rejects(readProjectFile(root, "sample.tar"), { status: 415 });
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
