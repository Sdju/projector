import { Duplex } from "node:stream";

/** A tunnel message stays small even when the HTTP side writes a whole JSON body at once. */
export const HUB_STREAM_CHUNK = 64 * 1024;

/**
 * Wraps a WebSocket duplex so each write becomes a bounded WebSocket message.
 *
 * `createWebSocketStream` turns one `write` into one frame. A server that answers a large chat
 * history with a single `res.end(json)` produces a frame of hundreds of kilobytes, while both
 * tunnel ends keep `maxPayload` at 256 KiB; the receiver then drops the socket and the Hub answers
 * `502`. Splitting only the frames keeps bodies streamed, so a large response still runs through
 * an older peer that has the small limit.
 */
export function chunkedStream(stream: Duplex, limit = HUB_STREAM_CHUNK): Duplex {
  const out = new Duplex({
    read() {
      stream.resume();
    },
    write(chunk: Buffer, _encoding, callback) {
      writeInChunks(stream, chunk, limit, callback);
    },
    final(callback) {
      stream.end(callback);
    },
    destroy(error, callback) {
      stream.destroy(error ?? undefined);
      callback(error);
    },
  });
  stream.on("data", (chunk: Buffer) => {
    if (!out.push(chunk)) stream.pause();
  });
  stream.once("end", () => out.push(null));
  stream.once("error", (error) => out.destroy(error));
  stream.once("close", () => {
    if (!out.destroyed) out.destroy();
  });
  return out;
}

function writeInChunks(
  stream: Duplex,
  chunk: Buffer,
  limit: number,
  done: (error?: Error | null) => void,
): void {
  if (chunk.length <= limit) {
    stream.write(chunk, done);
    return;
  }
  let offset = 0;
  let waiting = false;
  let settled = false;
  const settle = (error?: Error | null) => {
    if (settled) return;
    settled = true;
    stream.off("error", settle);
    stream.off("close", onClose);
    if (waiting) stream.off("drain", next);
    done(error);
  };
  const onClose = () => settle(new Error("Туннель закрыт"));
  const next = () => {
    if (settled) return;
    while (offset < chunk.length) {
      const piece = chunk.subarray(offset, offset + limit);
      offset += piece.length;
      if (!stream.write(piece)) {
        waiting = true;
        stream.once("drain", next);
        return;
      }
    }
    settle();
  };
  stream.once("error", settle);
  stream.once("close", onClose);
  next();
}
