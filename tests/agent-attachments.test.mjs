import { expect, test } from "vite-plus/test";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { Readable } from "node:stream";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { readAttachment, saveAttachment } from "../packages/server/modules/agent/attachments.ts";

/** `saveAttachment` only reads the request as a stream. */
const request = (content) => Readable.from([content]);

async function withDataHome(run) {
  const directory = await mkdtemp(join(tmpdir(), "projector-attachments-"));
  const previous = process.env.XDG_DATA_HOME;
  process.env.XDG_DATA_HOME = directory;
  try {
    return await run(directory);
  } finally {
    if (previous === undefined) delete process.env.XDG_DATA_HOME;
    else process.env.XDG_DATA_HOME = previous;
    await rm(directory, { recursive: true, force: true });
  }
}

test("a file of any type can be attached to the chat", () =>
  withDataHome(async (directory) => {
    const saved = await saveAttachment(request(Buffer.from("hello")), "text/plain", "note.txt");
    expect(saved.mime).toBe("application/octet-stream");
    expect(saved.name).toBe("note.txt");
    expect(saved.path).toBe(
      join(directory, "projector", "agent", "attachments", saved.id, "note.txt"),
    );
    expect(await readFile(saved.path, "utf8")).toBe("hello");
  }));

test("an attached name cannot escape the attachment folder", () =>
  withDataHome(async (directory) => {
    const saved = await saveAttachment(
      request(Buffer.from("x")),
      "application/octet-stream",
      "../../evil.txt",
    );
    expect(saved.name).toBe("evil.txt");
    expect(saved.path).toBe(
      join(directory, "projector", "agent", "attachments", saved.id, "evil.txt"),
    );
  }));

test("a picture keeps its type and is read back by id", () =>
  withDataHome(async (directory) => {
    const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    const saved = await saveAttachment(request(png), "image/png", "shot.png");
    expect(saved.mime).toBe("image/png");
    expect(saved.path).toBe(
      join(directory, "projector", "agent", "attachments", `${saved.id}.png`),
    );
    const stored = await readAttachment(saved.id);
    expect(stored.mime).toBe("image/png");
    expect(stored.content.equals(png)).toBe(true);
  }));

test("a file that only claims to be a picture is refused", () =>
  withDataHome(async () => {
    await expect(
      saveAttachment(request(Buffer.from("not a png")), "image/png", "x.png"),
    ).rejects.toMatchObject({ status: 400 });
  }));
